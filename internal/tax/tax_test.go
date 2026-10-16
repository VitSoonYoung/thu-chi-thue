package tax

import (
	"strconv"
	"testing"
)

func TestReferenceFixture(t *testing.T) {
	r := DefaultRule(2026)
	got := Calculate(&r, 2026, "1500000000", "400000000", "400000000", true, 7000)
	if got.RevenueMethod.Before != "25000000" || got.RevenueMethod.Reduction != "7500000" || got.RevenueMethod.Total != "17500000" {
		t.Fatalf("revenue: %+v", got.RevenueMethod)
	}
	if got.ProfitMethod.Before != "165000000" || got.ProfitMethod.Reduction != "49500000" || got.ProfitMethod.Total != "115500000" {
		t.Fatalf("profit: %+v", got.ProfitMethod)
	}
	if got.ProfitMethod.YourShare != "689150000" || got.ProfitMethod.PartnerShare != "295350000" {
		t.Fatalf("shares: %+v", got.ProfitMethod)
	}
	if r.Version != 1 || len(r.Sources) != 3 || r.Sources[0].URL == "" {
		t.Fatal("fixture requires versioned legal references")
	}
}
func TestBoundaries(t *testing.T) {
	for _, boundary := range []int64{1_000_000_000, 3_000_000_000, 10_000_000_000, 50_000_000_000} {
		for _, offset := range []int64{-1, 0, 1} {
			n := boundary + offset
			t.Run(strconv.FormatInt(n, 10), func(t *testing.T) {
				r := DefaultRule(2026)
				got := Calculate(&r, 2026, strconv.FormatInt(n, 10), "0", "0", true, 7000)
				if got.RevenueMethod.Applicable != (n <= 3_000_000_000) {
					t.Fatal("revenue eligibility")
				}
				if n <= 1_000_000_000 && (got.ProfitMethod.Total != "0" || got.RevenueMethod.Total != "0") {
					t.Fatal("exemption")
				}
				rate := int64(1500)
				if n > 50_000_000_000 {
					rate = 2000
				} else if n > 3_000_000_000 {
					rate = 1700
				}
				if got.ProfitMethod.Rate != rate {
					t.Fatal("rate")
				}
				if n > 1_000_000_000 && (n > 10_000_000_000) != (got.ProfitMethod.Reduction == "0") {
					t.Fatal("relief eligibility")
				}
			})
		}
	}
}
func TestAnnualRelief(t *testing.T) {
	for _, year := range []int{2025, 2026, 2027, 2028} {
		r := DefaultRule(year)
		got := Calculate(&r, year, "1500000000", "0", "0", true, 7000)
		want := "25000000"
		if year == 2026 || year == 2027 {
			want = "17500000"
		}
		if got.RevenueMethod.Total != want {
			t.Fatalf("%d: %s", year, got.RevenueMethod.Total)
		}
	}
}
func TestLossAndMissingRules(t *testing.T) {
	r := DefaultRule(2026)
	got := Calculate(&r, 2026, "1500000000", "2000000000", "2000000000", false, 7000)
	if got.ProfitMethod.Base != "0" || got.ProfitMethod.Total != "0" {
		t.Fatal("loss must not produce tax")
	}
	missing := Calculate(nil, 2030, "100", "0", "0", false, 7000)
	if missing.ProfitMethod.Applicable || missing.ProfitMethod.Reason == "" {
		t.Fatal("missing annual rule")
	}
}
func TestLargeExactAmounts(t *testing.T) {
	r := DefaultRule(2026)
	got := Calculate(&r, 2026, "9223372036854775807", "0", "0", true, 7000)
	if got.ProfitMethod.Total != "1844674407370955161" {
		t.Fatal(got.ProfitMethod.Total)
	}
}
func TestValidation(t *testing.T) {
	r := DefaultRule(2026)
	if e := Validate(r); e != nil {
		t.Fatal(e)
	}
	r.RevenueBPS = 10001
	if Validate(r) == nil {
		t.Fatal("invalid rate")
	}
	r = DefaultRule(2028)
	r.ReliefBPS = 3000
	if Validate(r) == nil {
		t.Fatal("invalid relief year")
	}
}
