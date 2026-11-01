//! On-device recognition starts a new utterance after a pause, and its results
//! then restate only the words since that pause. A take keeps every utterance:
//! a result whose first word comes after the last word of the one in progress
//! closes it, and one that starts where the take began restates the whole take.
//! Partial results may carry no timing; then a result that starts over, with
//! fewer words and a different opening, is the next utterance.

/// Seconds within which two results are taken to start at the same word.
const SAME: f64 = 0.05;

#[derive(Default)]
pub(crate) struct Stitch {
    kept: String,
    current: String,
    origin: Option<f64>,
    /// When the utterance in progress stops: its last word's end.
    end: f64,
}

impl Stitch {
    /// Takes a result's text and when its words were spoken (first word's
    /// start, last word's end), and returns the whole take so far.
    pub(crate) fn take(&mut self, text: &str, span: Option<(f64, f64)>) -> String {
        let text = text.trim();
        match span.filter(|&(_, end)| end > 0.0) {
            Some((start, end)) => {
                let origin = *self.origin.get_or_insert(start);
                if !self.current.is_empty() {
                    if start <= origin + SAME {
                        self.kept.clear();
                    } else if start >= self.end - SAME {
                        self.commit();
                    }
                }
                self.end = end;
            }
            None if !self.current.is_empty() => {
                if !self.kept.is_empty()
                    && opens_alike(text, &self.kept)
                    && words(text) >= words(&self.kept)
                {
                    self.kept.clear();
                } else if starts_over(text, &self.current) {
                    self.commit();
                }
            }
            None => {}
        }
        self.current = text.to_owned();
        self.text()
    }

    pub(crate) fn text(&self) -> String {
        join(&self.kept, &self.current)
    }

    fn commit(&mut self) {
        self.kept = join(&self.kept, &self.current);
    }
}

fn words(text: &str) -> usize {
    text.split_whitespace().count()
}

/// The same first word, give or take its ending: "Plan" and "Planned".
fn opens_alike(a: &str, b: &str) -> bool {
    let first = |text: &str| -> String {
        let word = text.split_whitespace().next().unwrap_or("");
        word.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect()
    };
    let (a, b) = (first(a), first(b));
    let shared = a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count();
    !a.is_empty()
        && !b.is_empty()
        && (shared >= 3 || a == b || a.starts_with(&b) || b.starts_with(&a))
}

/// A revision grows or rewords what is there; a new utterance starts again, shorter.
fn starts_over(text: &str, current: &str) -> bool {
    let (now, before) = (words(text), words(current));
    (!opens_alike(text, current) && now <= before)
        || (now * 2 <= before && !current.to_lowercase().starts_with(&text.to_lowercase()))
}

fn join(head: &str, tail: &str) -> String {
    match (head.is_empty(), tail.is_empty()) {
        (true, _) => tail.to_owned(),
        (_, true) => head.to_owned(),
        _ => format!("{head} {tail}"),
    }
}

#[cfg(test)]
mod tests {
    use super::Stitch;

    #[test]
    fn a_pause_keeps_what_came_before_it() {
        let mut take = Stitch::default();
        take.take("Plan my", Some((0.4, 0.9)));
        take.take("Plan my trip to Warsaw.", Some((0.4, 2.1)));
        assert_eq!(
            take.take("Book", Some((4.2, 4.5))),
            "Plan my trip to Warsaw. Book"
        );
        assert_eq!(
            take.take("Book a hotel.", Some((4.2, 5.3))),
            "Plan my trip to Warsaw. Book a hotel."
        );
    }

    #[test]
    fn a_result_that_restates_the_whole_take_replaces_it() {
        let mut take = Stitch::default();
        take.take("Plan my trip.", Some((0.4, 1.6)));
        take.take("Book a hotel.", Some((3.0, 4.1)));
        assert_eq!(
            take.take("Plan my trip. Book a hotel.", Some((0.4, 4.1))),
            "Plan my trip. Book a hotel."
        );
    }

    #[test]
    fn revisions_of_the_same_utterance_replace_each_other() {
        let mut take = Stitch::default();
        take.take("Plan my trip to work", Some((0.4, 1.8)));
        assert_eq!(
            take.take("Plan my trip to Warsaw", Some((0.7, 1.9))),
            "Plan my trip to Warsaw"
        );
    }

    #[test]
    fn untimed_results_grow_one_utterance() {
        let mut take = Stitch::default();
        take.take("Plan", None);
        take.take("Planned my", None);
        assert_eq!(take.take("Planned my trip", None), "Planned my trip");
    }

    #[test]
    fn an_untimed_result_that_starts_over_is_the_next_utterance() {
        let mut take = Stitch::default();
        take.take("Plan my trip to Warsaw.", None);
        assert_eq!(take.take("Book", None), "Plan my trip to Warsaw. Book");
        assert_eq!(
            take.take("Book a hotel", None),
            "Plan my trip to Warsaw. Book a hotel"
        );
        assert_eq!(
            take.take("Plan my trip to Warsaw. Book a hotel.", None),
            "Plan my trip to Warsaw. Book a hotel."
        );
    }
}
