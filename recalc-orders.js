require('dotenv').config();
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');

// ==================== FIREBASE INIT ====================
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ==================== ALL PATTERNS ====================
const ALL_PATTERNS = [
  { name: 'Merilah Pink', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Merilah Blue', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Tea Party (pink)', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Tea Party (blue)', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Castle Pink', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Castle Purple', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Girl Like You (blue)', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Girl Like You (pink)', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Blair', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Delancy', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Charming School', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Rainbow Magic', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Fairytopia', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Mermaidia', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Mariposa & Fairy Friend', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Odette', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Fairy Godmother', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Swan Lake', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Genevieve', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Rapunzel v.1', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Mariposa', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Rapunzel', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Rosella', sizeKey: 'normal', priceOrig: 399 },
  { name: 'God is Love', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Mermaid Melody', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Chocola', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Vanilla', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Pierre', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Magic Girl', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Sugar Rune', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Totally Cute', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Forevermore', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Sugarplum', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Veggies', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Floral Cottage', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Picnic', sizeKey: 'normal', priceOrig: 399 },
  { name: 'Magic Pegasus', sizeKey: 'large', priceOrig: 499 },
  { name: "Cupid's Odette", sizeKey: 'large', priceOrig: 499 },
  { name: 'Lady Pink', sizeKey: 'large', priceOrig: 499 },
  { name: 'Lady Cherry', sizeKey: 'large', priceOrig: 499 },
  { name: 'Moving Castle', sizeKey: 'large', priceOrig: 499 },
  { name: 'Peter Pan (Midnight)', sizeKey: 'large', priceOrig: 499 },
  { name: 'Peter Pan (Sweet Dream)', sizeKey: 'large', priceOrig: 499 },
  { name: "Diary's MARIE (mint)", sizeKey: 'easy', priceOrig: 425 },
  { name: "Diary's MARIE (purple)", sizeKey: 'easy', priceOrig: 425 },
];

// ==================== PROMO TIERS ====================
const PROMO_NORMAL = [{ bags: 1, price: 299 }, { bags: 2, price: 559 }, { bags: 3, price: 750 }];
const PROMO_LARGE  = [{ bags: 1, price: 449 }, { bags: 2, price: 699 }, { bags: 3, price: 990 }];
const PROMO_EASY   = [{ bags: 1, price: 355 }, { bags: 2, price: 630 }, { bags: 3, price: 800 }];

// ==================== COMPUTE PROMO (same as app.js) ====================
function computePromoPrice(patternQtys) {
  var groups = {};
  for (var name in patternQtys) {
    var p = ALL_PATTERNS.find(function(x) { return x.name === name; });
    if (!p) continue;
    if (!groups[p.sizeKey]) groups[p.sizeKey] = { totalBags: 0, origTotal: 0 };
    groups[p.sizeKey].totalBags += patternQtys[name];
    groups[p.sizeKey].origTotal += p.priceOrig * patternQtys[name];
  }

  var totalOrig = 0;
  var totalPromo = 0;

  for (var sk in groups) {
    var g = groups[sk];
    totalOrig += g.origTotal;
    var tiers = sk === 'normal' ? PROMO_NORMAL : sk === 'large' ? PROMO_LARGE : PROMO_EASY;
    var promo = 0;

    var remaining = g.totalBags;
    while (remaining > 0) {
      if (remaining >= 3) { promo += tiers[2].price; remaining -= 3; }
      else if (remaining === 2) { promo += tiers[1].price; remaining -= 2; }
      else { promo += tiers[0].price; remaining -= 1; }
    }

    totalPromo += promo;
  }

  return { original: totalOrig, promo: totalPromo, savings: totalOrig - totalPromo };
}

// ==================== SHIPPING ====================
const BASE_SHIPPING = 0;
const REMOTE_SHIPPING = 40;
const REMOTE_PROVINCES = [
  'ยะลา','ปัตตานี','นราธิวาส','ระนอง','แม่ฮ่องสอน','ตราด','เกาะกูด','เกาะช้าง',
  'กระบี่','เกาะลันตา','เกาะพีพี','ภูเก็ต','เกาะสมุย','เกาะพะงัน','เกาะเต่า',
  'ชุมพร','เกาะตาชัย','สตูล','เกาะหลีเป๊ะ','พังงา','เกาะยาว','เขาหลัก','ตรัง','เกาะรอก',
  'น่าน','ทุ่งช้าง','บ่อเกลือ','สันติสุข','แพร่','ร้องกวาง','วังชิ้น',
  'อุตรดิตถ์','น้ำปาด','ฟากท่า',
];

function isRemoteArea(address) {
  if (!address) return false;
  var addr = address.toLowerCase();
  for (var i = 0; i < REMOTE_PROVINCES.length; i++) {
    if (addr.indexOf(REMOTE_PROVINCES[i]) !== -1) return true;
  }
  return false;
}

// ==================== MAIN ====================
async function main() {
  console.log('Fetching orders from Firestore...');
  const snap = await getDocs(collection(db, 'orders'));
  console.log('Found ' + snap.size + ' orders\n');

  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const d of snap.docs) {
    const order = { _docId: d.id, ...d.data() };

    try {
      // Build pattern_qtys
      var patternQtys = order.pattern_qtys || {};
      if (Object.keys(patternQtys).length === 0) {
        (order.patterns || []).forEach(name => {
          patternQtys[name] = order.qty || 1;
        });
      }

      // Recalculate promo
      var result = computePromoPrice(patternQtys);

      // Calculate shipping
      var totalBags = Object.values(patternQtys).reduce((sum, q) => sum + q, 0);
      var isRemote = isRemoteArea(order.customer_info);
      var shippingCost = isRemote ? REMOTE_SHIPPING : BASE_SHIPPING;

      // Build updates
      var updates = {
        total_price: result.promo,
        original_price: result.original,
        savings: result.savings,
        shipping_cost: shippingCost,
        is_remote: isRemote,
        updated_at: new Date().toISOString(),
      };

      // Compare with existing
      var oldPrice = order.total_price || 0;
      var newPrice = result.promo;
      var oldShipping = order.shipping_cost != null ? order.shipping_cost : BASE_SHIPPING;

      if (oldPrice === newPrice && oldShipping === shippingCost) {
        unchanged++;
        console.log(`[SKIP] ${order.id} — same price ${newPrice} ฿`);
        continue;
      }

      // Update
      await updateDoc(doc(db, 'orders', d.id), updates);
      updated++;
      console.log(`[UPDATE] ${order.id} — ${oldPrice} → ${newPrice} ฿ (shipping ${oldShipping} → ${shippingCost})`);
    } catch (err) {
      errors++;
      console.error(`[ERROR] ${order.id}: ${err.message}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Updated: ${updated}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Errors: ${errors}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
