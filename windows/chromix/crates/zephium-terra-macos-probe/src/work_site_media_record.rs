//! A plain record's own paint: no image, canvas, SVG or background image.
use super::*;

pub(super) const NAME: &str = "Amber record";
const BACKGROUND: [u8; 3] = [192, 128, 32];
const BORDER: [u8; 3] = [24, 120, 184];

pub(super) fn page() -> String {
    "<!doctype html><html><head><title>Plain record fixture</title><style>body{margin:8px;font:14px/20px sans-serif}h1{font:18px/24px sans-serif;margin:0 0 8px}main{display:flex;gap:20px}article{box-sizing:border-box;width:220px;height:140px;padding:12px;border:4px solid rgb(24,120,184);background-color:rgb(192,128,32)}h2{font:16px/20px sans-serif;margin:0}p{margin:8px 0 0}#neighbor{background-color:rgb(40,160,88);border-color:rgb(192,48,80)}</style></head><body><h1>Two separate records</h1><main><article id='target'><h2>Amber record</h2><p>Fixture item 43</p></article><article id='neighbor'><h2>Green neighbor</h2><p>Fixture item 91</p></article></main></body></html>".into()
}

/// Border and background must belong to the target article, not its neighbour/grid.
/// Text is deliberately outside the sampled interior; no font raster assumptions.
pub(super) fn pixels(bytes: &[u8], report: bool) -> bool {
    if bytes.len() > MAX_RECORD_MEDIA_BYTES {
        return false;
    }
    let Ok(decoded) = image::load_from_memory_with_format(bytes, image::ImageFormat::Png) else {
        return false;
    };
    let image = decoded.to_rgba8();
    let (w, h) = image.dimensions();
    if w == 0 || h == 0 || w > 320 || h > 240 {
        return false;
    }
    let geometry = (i64::from(w) * 140 - i64::from(h) * 220).abs() <= 220;
    let near = |pixel: &image::Rgba<u8>, color: [u8; 3]| {
        pixel.0[3] >= 250 && (0..3).all(|c| pixel.0[c].abs_diff(color[c]) <= 12)
    };
    let mut edge_total = 0;
    let mut edge_match = 0;
    let mut interior_total = 0;
    let mut interior_match = 0;
    for (x, y, pixel) in image.enumerate_pixels() {
        if x == 0 || y == 0 || x + 1 == w || y + 1 == h {
            edge_total += 1;
            if near(pixel, BORDER) {
                edge_match += 1;
            }
        }
        // The source's lower middle is painted background, away from text/border.
        if x >= w / 4 && x < w * 3 / 4 && y >= h * 3 / 5 && y < h * 17 / 20 {
            interior_total += 1;
            if near(pixel, BACKGROUND) {
                interior_match += 1;
            }
        }
    }
    let passed = geometry
        && edge_total > 0
        && interior_total > 0
        && edge_match * 100 >= edge_total * 99
        && interior_match == interior_total;
    if report {
        let _ = writeln!(
            std::io::stdout().lock(),
            "media-fixture: record_oracle width={w} height={h} geometry={geometry} edge_total={edge_total} edge_match={edge_match} interior_total={interior_total} interior_match={interior_match} passed={passed}; pixels_exported=false"
        );
    }
    passed
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(background: [u8; 3], width: u32, height: u32) -> image::DynamicImage {
        let mut image = image::RgbaImage::from_pixel(
            width,
            height,
            image::Rgba([background[0], background[1], background[2], 255]),
        );
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            if x < 4 || y < 4 || x + 4 >= width || y + 4 >= height {
                *pixel = image::Rgba([BORDER[0], BORDER[1], BORDER[2], 255]);
            }
        }
        image::DynamicImage::ImageRgba8(image)
    }
    fn png(image: &image::DynamicImage) -> Vec<u8> {
        let mut out = Vec::new();
        image
            .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }
    #[test]
    fn plain_record_oracle_rejects_neighbour_grid_and_missing_border() {
        let target = fixture(BACKGROUND, 220, 140);
        assert!(pixels(&png(&target), false));
        // The unchanged 640-class page capture samples this CSS rectangle smaller.
        let sampled = target.resize_exact(109, 69, image::imageops::FilterType::Triangle);
        assert!(pixels(&png(&sampled), false));
        assert!(!pixels(&png(&fixture([40, 160, 88], 220, 140)), false));
        assert!(!pixels(&png(&fixture(BACKGROUND, 460, 140)), false));
        assert!(!pixels(&png(&target.crop_imm(4, 4, 212, 132)), false));
    }
}
