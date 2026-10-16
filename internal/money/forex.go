package money

import (
	"errors"
	"math/big"
	"strconv"
)

func ConvertUSD(centsRaw, rateRaw string) (int64, int64, int64, error) {
	cents, err := strconv.ParseInt(centsRaw, 10, 64)
	if err != nil || cents == 0 {
		return 0, 0, 0, errors.New("Số USD không hợp lệ")
	}
	rate, err := strconv.ParseInt(rateRaw, 10, 64)
	if err != nil || rate <= 0 || rate > 1_000_000_000 {
		return 0, 0, 0, errors.New("Nhập tỷ giá USD hợp lệ")
	}
	value := new(big.Int).Mul(new(big.Int).Abs(big.NewInt(cents)), big.NewInt(rate))
	value.Add(value, big.NewInt(50)).Quo(value, big.NewInt(100))
	if cents < 0 {
		value.Neg(value)
	}
	if !value.IsInt64() || value.Sign() == 0 {
		return 0, 0, 0, errors.New("Số tiền quy đổi nằm ngoài giới hạn VND")
	}
	return value.Int64(), cents, rate, nil
}
