#!/bin/bash
# Test: promo pricing + per-pattern qty + CRUD
BASE="http://localhost:3000"
COOKIES="/tmp/test_cookies.txt"
PASS="helloxglitter"
PASSED=0
FAILED=0

pass() { PASSED=$((PASSED+1)); echo "  ✅ $1"; }
fail() { FAILED=$((FAILED+1)); echo "  ❌ $1"; }

echo "========================================"
echo "  TEST: Promo Pricing + CRUD"
echo "========================================"
echo ""

# ============ 1. AUTH ============
echo "── 1. AUTH ──"
curl -s -X POST "$BASE/api/login" -H "Content-Type: application/json" -d "{\"password\":\"$PASS\"}" -c "$COOKIES" > /dev/null
RES=$(curl -s -b "$COOKIES" "$BASE/api/check-auth")
echo "$RES" | grep -q '"authenticated":true' && pass "Login OK" || fail "Login: $RES"

# ============ 2. PROMO PRICING TESTS ============
echo ""
echo "── 2. PROMO PRICING ──"

# Normal 1 bag: 399 -> 299, save 100
RES=$(curl -s -X POST "$BASE/api/orders" -H "Content-Type: application/json" \
  -d '{"customer_info":"T1","patterns":["Merilah Pink"],"pattern_qtys":{"Merilah Pink":1},"total_bags":1,"original_price":399,"total_price":299,"savings":100}')
echo "$RES" | python3 -c "
import sys,json
o=json.load(sys.stdin)['order']
assert o['total_price']==299, f'Expected 299, got {o[\"total_price\"]}'
assert o['original_price']==399, f'Expected 399, got {o[\"original_price\"]}'
assert o['savings']==100, f'Expected 100, got {o[\"savings\"]}'
" 2>&1 && pass "Normal 1 bag: 299 (save 100)" || fail "Normal 1 bag"

# Normal 2 bags: 798 -> 559, save 239
RES=$(curl -s -X POST "$BASE/api/orders" -H "Content-Type: application/json" \
  -d '{"customer_info":"T2","patterns":["Merilah Pink","Blair"],"pattern_qtys":{"Merilah Pink":1,"Blair":1},"total_bags":2,"original_price":798,"total_price":559,"savings":239}')
echo "$RES" | python3 -c "
import sys,json
o=json.load(sys.stdin)['order']
assert o['total_price']==559, f'Expected 559, got {o[\"total_price\"]}'
assert o['savings']==239, f'Expected 239, got {o[\"savings\"]}'
" 2>&1 && pass "Normal 2 bags: 559 (save 239)" || fail "Normal 2 bags"

# Normal 3 bags: 1197 -> 800, save 397
RES=$(curl -s -X POST "$BASE/api/orders" -H "Content-Type: application/json" \
  -d '{"customer_info":"T3","patterns":["Merilah Pink","Blair","Rapunzel"],"pattern_qtys":{"Merilah Pink":1,"Blair":1,"Rapunzel":1},"total_bags":3,"original_price":1197,"total_price":800,"savings":397}')
echo "$RES" | python3 -c "
import sys,json
o=json.load(sys.stdin)['order']
assert o['total_price']==800, f'Expected 800, got {o[\"total_price\"]}'
assert o['savings']==397, f'Expected 397, got {o[\"savings\"]}'
" 2>&1 && pass "Normal 3 bags: 800 (save 397)" || fail "Normal 3 bags"

# Mixed sizes: 2 normal + 1 large = 559+449=1008
RES=$(curl -s -X POST "$BASE/api/orders" -H "Content-Type: application/json" \
  -d '{"customer_info":"T4","patterns":["Merilah Pink","Blair","Magic Pegasus"],"pattern_qtys":{"Merilah Pink":1,"Blair":1,"Magic Pegasus":1},"total_bags":3,"original_price":1297,"total_price":1008,"savings":289}')
echo "$RES" | python3 -c "
import sys,json
o=json.load(sys.stdin)['order']
assert o['total_price']==1008, f'Expected 1008, got {o[\"total_price\"]}'
assert o['savings']==289, f'Expected 289, got {o[\"savings\"]}'
" 2>&1 && pass "Mixed sizes: 1008 (save 289)" || fail "Mixed sizes"

# Normal per-pattern qty: Merilah Pink x2 + Blair x1 = 3 bags -> 800
RES=$(curl -s -X POST "$BASE/api/orders" -H "Content-Type: application/json" \
  -d '{"customer_info":"T5","patterns":["Merilah Pink","Blair"],"pattern_qtys":{"Merilah Pink":2,"Blair":1},"total_bags":3,"original_price":1197,"total_price":800,"savings":397}')
echo "$RES" | python3 -c "
import sys,json
o=json.load(sys.stdin)['order']
assert o['total_price']==800, f'Expected 800, got {o[\"total_price\"]}'
assert o['total_bags']==3
" 2>&1 && pass "Per-pattern qty 2+1=3 bags: 800" || fail "Per-pattern qty"

# Large 2 bags: 998 -> 559, save 439
RES=$(curl -s -X POST "$BASE/api/orders" -H "Content-Type: application/json" \
  -d '{"customer_info":"T6","patterns":["Magic Pegasus","Cupid'\''s Odette"],"pattern_qtys":{"Magic Pegasus":1,"Cupid'\''s Odette":1},"total_bags":2,"original_price":998,"total_price":559,"savings":439}')
echo "$RES" | python3 -c "
import sys,json
o=json.load(sys.stdin)['order']
assert o['total_price']==559, f'Expected 559, got {o[\"total_price\"]}'
assert o['savings']==439, f'Expected 439, got {o[\"savings\"]}'
" 2>&1 && pass "Large 2 bags: 559 (save 439)" || fail "Large 2 bags"

# Easy 1 bag: 425 -> 355, save 70
RES=$(curl -s -X POST "$BASE/api/orders" -H "Content-Type: application/json" \
  -d '{"customer_info":"T7","patterns":["Diary'\''s MARIE (mint)"],"pattern_qtys":{"Diary'\''s MARIE (mint)":1},"total_bags":1,"original_price":425,"total_price":355,"savings":70}')
echo "$RES" | python3 -c "
import sys,json
o=json.load(sys.stdin)['order']
assert o['total_price']==355, f'Expected 355, got {o[\"total_price\"]}'
assert o['savings']==70, f'Expected 70, got {o[\"savings\"]}'
" 2>&1 && pass "Easy 1 bag: 355 (save 70)" || fail "Easy 1 bag"

# ============ 3. LIST ALL ============
echo ""
echo "── 3. LIST + VERIFY ──"
RES=$(curl -s -b "$COOKIES" "$BASE/api/orders")
COUNT=$(echo "$RES" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
[ "$COUNT" -eq 7 ] && pass "List returns 7 orders" || fail "Expected 7, got $COUNT"

# Verify all have savings
echo "$RES" | python3 -c "
import sys,json
orders=json.load(sys.stdin)
for o in orders:
    assert o.get('savings',0) > 0, f'{o[\"id\"]} should have savings'
    assert o.get('original_price',0) > o['total_price'], f'{o[\"id\"]} orig > promo'
print('     All 7 orders have correct pricing')
" 2>&1 && pass "All orders have savings" || fail "Savings check"

# ============ 4. STATS ============
echo ""
echo "── 4. STATS ──"
RES=$(curl -s -b "$COOKIES" "$BASE/api/stats")
echo "$RES" | python3 -c "
import sys,json
s=json.load(sys.stdin)
assert s['total_orders']==7
print(f'     orders={s[\"total_orders\"]} bags={s[\"total_bags\"]} revenue={s[\"total_price\"]}')
" 2>&1 && pass "Stats correct" || fail "Stats"

# ============ 5. UPDATE ============
echo ""
echo "── 5. UPDATE ──"
FIRST=$(echo "$RES" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['_docId'])" 2>/dev/null || echo "")
if [ -n "$FIRST" ]; then
  curl -s -X PUT "$BASE/api/orders/$FIRST" -b "$COOKIES" -H "Content-Type: application/json" \
    -d '{"status":1}' | grep -q '"status":1' && pass "Update status" || fail "Update"
fi

# ============ 6. DELETE ALL ============
echo ""
echo "── 6. CLEANUP ──"
IDS=$(curl -s -b "$COOKIES" "$BASE/api/orders" | python3 -c "import sys,json;[print(o['_docId']) for o in json.load(sys.stdin)]")
DELETED=0
for id in $IDS; do
  curl -s -X DELETE "$BASE/api/orders/$id" -b "$COOKIES" > /dev/null
  DELETED=$((DELETED+1))
done
[ "$DELETED" -eq 7 ] && pass "Deleted all 7 orders" || fail "Deleted $DELETED/7"

# ============ 7. PAGES ============
echo ""
echo "── 7. PAGES ──"
curl -s -o /dev/null -w "%{http_code}" "$BASE/" | grep -q 200 && pass "Main page" || fail "Main"
curl -s -o /dev/null -w "%{http_code}" "$BASE/admin/" | grep -q 200 && pass "Admin page" || fail "Admin"
curl -s -o /dev/null -w "%{http_code}" "$BASE/track/" | grep -q 200 && pass "Track page" || fail "Track"

# ============ RESULTS ============
TOTAL=$((PASSED+FAILED))
echo ""
echo "========================================"
echo "  RESULTS: $PASSED / $TOTAL passed"
echo "========================================"
if [ "$FAILED" -eq 0 ]; then
  echo "🎉 ALL TESTS PASSED!"
  exit 0
else
  echo "⚠️  $FAILED TEST(S) FAILED"
  exit 1
fi
