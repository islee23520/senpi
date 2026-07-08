//go:build !race

package app_test

// raceDetectorEnabled reports whether this test binary was built with -race,
// so timing-budget assertions can skip under instrumentation overhead.
const raceDetectorEnabled = false
