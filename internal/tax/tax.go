package tax

import (
	"errors"
	"math/big"
	"net/url"
	"strings"
	"time"
)

type Source struct {
	Title         string `json:"title"`
	Number        string `json:"number"`
	URL           string `json:"url"`
	EffectiveFrom string `json:"effective_from"`
	VerifiedAt    string `json:"verified_at"`
	Status        string `json:"status"`
}
type Rule struct {
	Year          int      `json:"year"`
	Version       int      `json:"version"`
	Threshold     int64    `json:"threshold"`
	ChoiceLimit   int64    `json:"choice_limit"`
	MiddleLimit   int64    `json:"middle_limit"`
	ReliefLimit   int64    `json:"relief_limit"`
	RevenueBPS    int64    `json:"revenue_bps"`
	LowBPS        int64    `json:"low_bps"`
	MiddleBPS     int64    `json:"middle_bps"`
	HighBPS       int64    `json:"high_bps"`
	ReliefBPS     int64    `json:"relief_bps"`
	EffectiveFrom string   `json:"effective_from"`
	VerifiedAt    string   `json:"verified_at"`
	Status        string   `json:"status"`
	Reason        string   `json:"reason"`
	Sources       []Source `json:"sources"`
}
type Method struct {
	Applicable   bool   `json:"applicable"`
	Reason       string `json:"reason"`
	Base         string `json:"base"`
	Rate         int64  `json:"rate"`
	Before       string `json:"before"`
	Reduction    string `json:"reduction"`
	Total        string `json:"total"`
	AfterTax     string `json:"after_tax"`
	YourShare    string `json:"your_share"`
	PartnerShare string `json:"partner_share"`
}
type Result struct {
	Year          int    `json:"year"`
	Rule          *Rule  `json:"rule"`
	Revenue       string `json:"revenue"`
	Expenses      string `json:"expenses"`
	Deductible    string `json:"deductible"`
	Confirmed     bool   `json:"confirmed"`
	Locked        bool   `json:"locked"`
	Method        string `json:"method"`
	RevenueMethod Method `json:"revenue_method"`
	ProfitMethod  Method `json:"profit_method"`
}

func DefaultRule(year int) Rule {
	relief := int64(0)
	if year == 2026 || year == 2027 {
		relief = 3000
	}
	return Rule{Year: year, Version: 1, Threshold: 1_000_000_000, ChoiceLimit: 3_000_000_000, MiddleLimit: 50_000_000_000, ReliefLimit: 10_000_000_000, RevenueBPS: 500, LowBPS: 1500, MiddleBPS: 1700, HighBPS: 2000, ReliefBPS: relief, EffectiveFrom: "2026-01-01", Status: "reference", Reason: "Cấu hình tham khảo từ GDD. Cần xác nhận ngành nghề, cơ sở doanh thu và điều kiện cư trú.", Sources: []Source{
		{Title: "Luật Thuế thu nhập cá nhân", Number: "109/2025/QH15", URL: "https://nif.mof.gov.vn/hoidapcstc/home/cthoidap/160704", EffectiveFrom: "2026-01-01", Status: "reference"},
		{Title: "Nghị định về chính sách thuế", Number: "141/2026/NĐ-CP", URL: "https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-so-141-2026-nd-cp-nang-nguong-doanh-thu-khong-phai-chiu-thue-len-1-ty-dong-119260504154326455.htm", EffectiveFrom: "2026-01-01", Status: "reference"},
		{Title: "Nghị quyết về giảm thuế", Number: "43/2026/QH16", URL: "https://chinhphu.vn/?classid=1&docid=219330&orggroupid=1&pageid=27160", EffectiveFrom: "2026-01-01", Status: "reference"},
	}}
}
func Validate(r Rule) error {
	if r.Year < 2000 || r.Year > 2100 || r.Threshold < 0 || r.ChoiceLimit < r.Threshold || r.MiddleLimit < r.ChoiceLimit || r.ReliefLimit < 0 {
		return errors.New("Ngưỡng doanh thu hoặc năm không hợp lệ")
	}
	for _, v := range []int64{r.RevenueBPS, r.LowBPS, r.MiddleBPS, r.HighBPS, r.ReliefBPS} {
		if v < 0 || v > 10000 {
			return errors.New("Tỷ lệ phải nằm trong khoảng 0% đến 100%")
		}
	}
	if r.Year != 2026 && r.Year != 2027 && r.ReliefBPS != 0 {
		return errors.New("Ưu đãi này chỉ được cấu hình cho năm 2026 và 2027")
	}
	if _, e := time.Parse("2006-01-02", r.EffectiveFrom); e != nil {
		return errors.New("Ngày hiệu lực không hợp lệ")
	}
	if len(r.Sources) == 0 {
		return errors.New("Cần ít nhất một nguồn pháp lý cho quy tắc")
	}
	for _, source := range r.Sources {
		u, e := url.Parse(source.URL)
		if strings.TrimSpace(source.Title) == "" || e != nil || u.Scheme != "https" || u.Host == "" {
			return errors.New("Tên văn bản và liên kết HTTPS của nguồn pháp lý phải hợp lệ")
		}
	}
	if r.VerifiedAt != "" {
		if _, e := time.Parse("2006-01-02", r.VerifiedAt); e != nil {
			return errors.New("Ngày xác minh không hợp lệ")
		}
	}
	if len(r.Reason) < 5 {
		return errors.New("Cần ghi lý do thay đổi quy tắc")
	}
	return nil
}
func number(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return new(big.Int)
	}
	return v
}
func maxZero(v *big.Int) *big.Int {
	if v.Sign() < 0 {
		return new(big.Int)
	}
	return v
}
func percentage(v *big.Int, bps int64) *big.Int {
	n := new(big.Int).Mul(new(big.Int).Abs(v), big.NewInt(bps))
	n.Add(n, big.NewInt(5000))
	n.Quo(n, big.NewInt(10000))
	if v.Sign() < 0 {
		n.Neg(n)
	}
	return n
}
func Calculate(rule *Rule, year int, revenue, expenses, deductible string, confirmed bool, share int64) Result {
	result := Result{Year: year, Rule: rule, Revenue: revenue, Expenses: expenses, Deductible: deductible, Confirmed: confirmed}
	if rule == nil {
		result.RevenueMethod.Reason = "Chưa có quy tắc cho năm này"
		result.ProfitMethod.Reason = result.RevenueMethod.Reason
		return result
	}
	rev, cost, exp := number(revenue), number(deductible), number(expenses)
	exempt := rev.Cmp(big.NewInt(rule.Threshold)) <= 0
	relief := int64(0)
	if (year == 2026 || year == 2027) && rev.Cmp(big.NewInt(rule.ReliefLimit)) <= 0 {
		relief = rule.ReliefBPS
	}
	makeMethod := func(base *big.Int, rate int64, applicable bool) Method {
		before := percentage(base, rate)
		if exempt {
			before.SetInt64(0)
			base.SetInt64(0)
		}
		reduction := percentage(before, relief)
		total := new(big.Int).Sub(before, reduction)
		after := new(big.Int).Sub(new(big.Int).Sub(rev, exp), total)
		yours := percentage(after, share)
		partner := new(big.Int).Sub(after, yours)
		m := Method{Applicable: applicable, Base: base.String(), Rate: rate, Before: before.String(), Reduction: reduction.String(), Total: total.String(), AfterTax: after.String(), YourShare: yours.String(), PartnerShare: partner.String()}
		if exempt {
			m.Reason = "Doanh thu năm không vượt ngưỡng miễn thuế"
		} else if !applicable {
			m.Reason = "Doanh thu năm vượt giới hạn lựa chọn phương pháp này"
			m.Total = "0"
		} else if !confirmed {
			m.Reason = "Cần xác minh cơ sở doanh thu, chi phí và điều kiện áp dụng"
		}
		return m
	}
	rate := rule.LowBPS
	if rev.Cmp(big.NewInt(rule.MiddleLimit)) > 0 {
		rate = rule.HighBPS
	} else if rev.Cmp(big.NewInt(rule.ChoiceLimit)) > 0 {
		rate = rule.MiddleBPS
	}
	result.RevenueMethod = makeMethod(maxZero(new(big.Int).Sub(rev, big.NewInt(rule.Threshold))), rule.RevenueBPS, rev.Cmp(big.NewInt(rule.ChoiceLimit)) <= 0)
	result.ProfitMethod = makeMethod(maxZero(new(big.Int).Sub(rev, cost)), rate, true)
	return result
}
