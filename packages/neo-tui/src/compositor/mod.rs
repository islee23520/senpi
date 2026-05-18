//! Compositor: layered `Component` dispatch (helix-style).
//!
//! Real implementation lands in T10. This stub locks the `Component` trait
//! and the `EventResult` enum so dependent modules compile.

use crossterm::event::Event;
use ratatui::{Frame, layout::Rect};

/// Bubble-or-consume signal returned by `Component::handle_event`.
#[derive(Debug)]
pub enum EventResult {
    Consumed,
    Ignored,
}

/// Trait every UI element implements.
pub trait Component {
    fn handle_event(&mut self, event: &Event) -> EventResult;
    fn render(&mut self, area: Rect, frame: &mut Frame<'_>);
    fn cursor(&self, _area: Rect) -> Option<(u16, u16)> {
        None
    }
}

/// Stack-of-layers compositor; T10 implements the routing loop.
#[derive(Default)]
pub struct Compositor {
    pub layers: Vec<Box<dyn Component>>,
}

impl Compositor {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

impl std::fmt::Debug for Compositor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Compositor")
            .field("layer_count", &self.layers.len())
            .finish()
    }
}
