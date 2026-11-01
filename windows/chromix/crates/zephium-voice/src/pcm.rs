//! Speech audio for a transcription upload: mono, at most 16 kHz, 16-bit,
//! held in memory only and framed as a WAV body.

/// Every hosted recognizer resamples to this; sending more only costs bytes.
pub const SPEECH_RATE: u32 = 16_000;

/// Mono 16-bit samples at `rate`, bounded to `capacity` samples.
pub struct Take {
    rate: u32,
    /// Input samples per output sample (≥ 1).
    step: f64,
    /// Input position of the next output sample's window end.
    next: f64,
    position: f64,
    sum: f64,
    count: u32,
    samples: Vec<i16>,
    capacity: usize,
}

impl Take {
    /// Audio arriving at `input_rate` Hz, kept for at most `max_ms`.
    pub fn new(input_rate: f64, max_ms: u32) -> Self {
        let input_rate = if input_rate.is_finite() && input_rate >= 1.0 {
            input_rate
        } else {
            f64::from(SPEECH_RATE)
        };
        let rate = (input_rate.round() as u32).clamp(1, SPEECH_RATE);
        let step = input_rate / f64::from(rate);
        let capacity = (u64::from(rate) * u64::from(max_ms) / 1_000) as usize;
        Self {
            rate,
            step,
            next: step,
            position: 0.0,
            sum: 0.0,
            count: 0,
            samples: Vec::with_capacity(capacity.min(rate as usize * 30)),
            capacity,
        }
    }

    /// Adds mono samples in −1…1. A box average over each output period is
    /// the low-pass, which is enough for speech going to a recognizer.
    pub fn push(&mut self, input: &[f32]) {
        for sample in input {
            if self.samples.len() >= self.capacity {
                return;
            }
            self.sum += f64::from(if sample.is_finite() { *sample } else { 0.0 });
            self.count += 1;
            self.position += 1.0;
            if self.position >= self.next {
                let mean = self.sum / f64::from(self.count);
                self.samples
                    .push((mean.clamp(-1.0, 1.0) * f64::from(i16::MAX)).round() as i16);
                self.sum = 0.0;
                self.count = 0;
                self.next += self.step;
            }
        }
    }

    #[cfg(test)]
    pub fn rate(&self) -> u32 {
        self.rate
    }

    pub fn duration_ms(&self) -> u64 {
        self.samples.len() as u64 * 1_000 / u64::from(self.rate)
    }

    /// The take as a complete RIFF/WAVE file.
    pub fn into_wav(self) -> Vec<u8> {
        wav(&self.samples, self.rate)
    }
}

/// A canonical 44-byte-header PCM16 mono WAV.
pub fn wav(samples: &[i16], rate: u32) -> Vec<u8> {
    let data = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16_u32.to_le_bytes());
    out.extend_from_slice(&1_u16.to_le_bytes());
    out.extend_from_slice(&1_u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2_u16.to_le_bytes());
    out.extend_from_slice(&16_u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forty_eight_kilohertz_becomes_sixteen_with_the_same_duration() {
        let mut take = Take::new(48_000.0, 60_000);
        take.push(&vec![0.5; 48_000]);
        assert_eq!(take.rate(), SPEECH_RATE);
        assert_eq!(take.duration_ms(), 1_000);
        let wav = take.into_wav();
        assert_eq!(wav.len(), 44 + 32_000);
        let first = i16::from_le_bytes([wav[44], wav[45]]);
        assert_eq!(first, (0.5 * f64::from(i16::MAX)).round() as i16);
    }

    #[test]
    fn odd_rates_keep_their_duration_and_slow_rates_are_not_upsampled() {
        let mut take = Take::new(44_100.0, 60_000);
        for _ in 0..10 {
            take.push(&vec![0.0; 4_410]);
        }
        assert!((999..=1_000).contains(&take.duration_ms()));
        let mut slow = Take::new(8_000.0, 60_000);
        slow.push(&vec![0.0; 8_000]);
        assert_eq!(slow.rate(), 8_000);
        assert_eq!(slow.duration_ms(), 1_000);
    }

    #[test]
    fn averaging_removes_content_above_the_new_nyquist() {
        let mut take = Take::new(48_000.0, 1_000);
        let alternating: Vec<f32> = (0..4_800)
            .map(|n| if n % 2 == 0 { 0.9 } else { -0.9 })
            .collect();
        take.push(&alternating);
        let wav = take.into_wav();
        let loudest = wav[44..]
            .chunks(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]).unsigned_abs())
            .max()
            .unwrap();
        assert!(loudest < 11_000, "{loudest}");
    }

    #[test]
    fn the_take_stops_growing_at_its_limit_and_clamps_peaks() {
        let mut take = Take::new(16_000.0, 500);
        take.push(&vec![2.0; 32_000]);
        assert_eq!(take.duration_ms(), 500);
        let wav = take.into_wav();
        assert_eq!(i16::from_le_bytes([wav[44], wav[45]]), i16::MAX);
    }

    #[test]
    fn the_header_describes_mono_pcm16() {
        let wav = wav(&[1, -1], 16_000);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(wav[4..8].try_into().unwrap()), 36 + 4);
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(u16::from_le_bytes([wav[22], wav[23]]), 1);
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 16_000);
        assert_eq!(u16::from_le_bytes([wav[34], wav[35]]), 16);
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 4);
    }
}
