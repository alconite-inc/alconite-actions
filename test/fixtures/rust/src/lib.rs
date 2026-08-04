/// Adds two unsigned integers.
#[must_use]
pub const fn add(left: u32, right: u32) -> u32 {
    left + right
}

#[cfg(test)]
mod tests {
    use super::add;

    #[test]
    fn adds_values() {
        assert_eq!(add(2, 2), 4);
    }
}
