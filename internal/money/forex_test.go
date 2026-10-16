package money

import "testing"

func TestConvertUSD(t *testing.T) {
	for _, tc := range []struct {
		cents, rate string
		want        int64
	}{{"10050", "25000", 2512500}, {"1", "25050", 251}, {"-1", "25050", -251}, {"-10050", "25000", -2512500}} {
		got, _, _, e := ConvertUSD(tc.cents, tc.rate)
		if e != nil || got != tc.want {
			t.Fatalf("%+v: %d %v", tc, got, e)
		}
	}
	for _, tc := range [][2]string{{"100", "0"}, {"1", "1"}, {"abc", "25000"}, {"100", "-1"}, {"9223372036854775807", "25000"}, {"100", "1000000001"}} {
		if _, _, _, e := ConvertUSD(tc[0], tc[1]); e == nil {
			t.Fatalf("invalid conversion accepted: %+v", tc)
		}
	}
}
