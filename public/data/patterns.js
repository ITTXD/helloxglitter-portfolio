// ==================== SHARED DATA (Single Source of Truth) ====================
// Used by both customer page (app.js) and admin panel (admin.js)

var NORMAL_PATTERNS=[
  {name:'Merilah Pink',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-01.jpg'},
  {name:'Merilah Blue',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-02.jpg'},
  {name:'Tea Party (pink)',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-03.jpg'},
  {name:'Tea Party (blue)',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-04.jpg'},
  {name:'Castle Pink',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-05.jpg'},
  {name:'Castle Purple',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-06.jpg'},
  {name:'Girl Like You (blue)',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-07.jpg'},
  {name:'Girl Like You (pink)',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-08.jpg'},
  {name:'Blair',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-09.jpg'},
  {name:'Delancy',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-10.jpg'},
  {name:'Charming School',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-11.jpg'},
  {name:'Rainbow Magic',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-12.jpg'},
  {name:'Fairytopia',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-13.jpg'},
  {name:'Mermaidia',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-14.jpg'},
  {name:'Mariposa & Fairy Friend',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-15.jpg'},
  {name:'Odette',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-16.jpg'},
  {name:'Fairy Godmother',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-17.jpg'},
  {name:'Swan Lake',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-18.jpg'},
  {name:'Genevieve',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-19.jpg'},
  {name:'Rapunzel v.1',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-20.jpg'},
  {name:'Mariposa',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-21.jpg'},
  {name:'Rapunzel',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-22.jpg'},
  {name:'Rosella',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-23.jpg'},
  {name:'God is Love',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-24.jpg'},
  {name:'Mermaid Melody',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-25.jpg'},
  {name:'Chocola',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-26.jpg'},
  {name:'Vanilla',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-27.jpg'},
  {name:'Pierre',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-28.jpg'},
  {name:'Magic Girl',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-29.jpg'},
  {name:'Sugar Rune',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-30.jpg'},
  {name:'Totally Cute',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-31.jpg'},
  {name:'Forevermore',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-32.jpg'},
  {name:'Sugarplum',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-33.jpg'},
  {name:'Veggies',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-34.png'},
  {name:'Floral Cottage',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-35.png'},
  {name:'Picnic',size:'15 × 16 inch',sizeKey:'normal',priceOrig:399,img:'/images/normal-36.png'}
];
var LARGE_PATTERNS=[
  {name:'Magic Pegasus',size:'15.5 × 4 × 16 inch',sizeKey:'large',priceOrig:499,img:'/images/large-01.jpg'},
  {name:'Cupid\'s Odette',size:'15.5 × 4 × 16 inch',sizeKey:'large',priceOrig:499,img:'/images/large-02.jpg'},
  {name:'Lady Pink',size:'15.5 × 4 × 16 inch',sizeKey:'large',priceOrig:499,img:'/images/large-03.jpg'},
  {name:'Lady Cherry',size:'15.5 × 4 × 16 inch',sizeKey:'large',priceOrig:499,img:'/images/large-04.jpg'},
  {name:'Moving Castle',size:'15.5 × 4 × 16 inch',sizeKey:'large',priceOrig:499,img:'/images/large-05.jpg'},
  {name:'Peter Pan (Midnight)',size:'15.5 × 4 × 16 inch',sizeKey:'large',priceOrig:499,img:'/images/large-06.jpg'},
  {name:'Peter Pan (Sweet Dream)',size:'15.5 × 4 × 16 inch',sizeKey:'large',priceOrig:499,img:'/images/large-07.jpg'}
];
var EASY_PATTERNS=[
  {name:'Diary\'s MARIE (mint)',size:'10.5 × 5 × 14 inch',sizeKey:'easy',priceOrig:425,img:'/images/easy-01.jpg'},
  {name:'Diary\'s MARIE (purple)',size:'10.5 × 5 × 14 inch',sizeKey:'easy',priceOrig:425,img:'/images/easy-02.jpg'}
];
var MAXI_PATTERNS=[
  {name:'Diary\'s Musketeers',size:'13.5 × 6 × 17 inch',sizeKey:'maxi',priceOrig:550,img:'/images/Maxxi2.png'}
];
var ALL_PATTERNS = NORMAL_PATTERNS.concat(LARGE_PATTERNS).concat(EASY_PATTERNS).concat(MAXI_PATTERNS);

// ==================== WALLPAPER PATTERNS ====================
var WP_PATTERNS = [
  {name:'Wallpaper',price:99,img:'/images/normal-01.jpg'}
];

// ==================== PROMO TIERS (disabled — using full prices) ====================
// var PROMO_NORMAL = [{ bags: 1, price: 299 }, { bags: 2, price: 559 }, { bags: 3, price: 750 }];
// var PROMO_LARGE  = [{ bags: 1, price: 449 }, { bags: 2, price: 699 }, { bags: 3, price: 990 }];
// var PROMO_EASY   = [{ bags: 1, price: 355 }, { bags: 2, price: 630 }, { bags: 3, price: 800 }];
// var PROMO_MAXI   = [{ bags: 1, price: 499 }, { bags: 2, price: 900 }];

// ==================== SHIPPING ====================
var BASE_SHIPPING = 50;
var REMOTE_SHIPPING = 65;
var REMOTE_PROVINCES = [
  'ยะลา','ปัตตานี','นราธิวาส',
  'ระนอง',
  'แม่ฮ่องสอน',
  'ตราด','เกาะกูด','เกาะช้าง',
  'กระบี่','เกาะลันตา','เกาะพีพี',
  'ภูเก็ต','เกาะสมุย','เกาะพะงัน','เกาะเต่า',
  'ชุมพร','เกาะตาชัย',
  'สตูล','เกาะหลีเป๊ะ',
  'พังงา','เกาะยาว','เขาหลัก',
  'ตรัง','เกาะรอก',
  'น่าน','ทุ่งช้าง','บ่อเกลือ','สันติสุข',
  'แพร่','ร้องกวาง','วังชิ้น',
  'อุตรดิตถ์','น้ำปาด','ฟากท่า',
];

// ==================== STATUS ====================
var STATUS_LABELS = ['รอยืนยัน', 'ยืนยันแล้ว', 'กำลังผลิต', 'จัดส่งแล้ว'];
var STATUS_ICONS = ['ti-clock', 'ti-circle-check', 'ti-tool', 'ti-truck'];

// ==================== 9.9 FLASH SALE CONFIG ====================
var FLASH_SALE_DISCOUNT = 39;
var FLASH_SALE_END_TIME = new Date('2026-09-09T23:59:59+07:00').getTime();

function isFlashSaleActive() {
  return Date.now() <= FLASH_SALE_END_TIME;
}

// ==================== PROMO LOGIC ====================
function computePromoPrice(patternQtys) {
  var total = 0;
  var totalBags = 0;
  for (var name in patternQtys) {
    var p = ALL_PATTERNS.find(function(x) { return x.name === name; });
    if (!p) continue;
    var q = patternQtys[name] || 0;
    total += p.priceOrig * q;
    totalBags += q;
  }

  var active = isFlashSaleActive();
  var discountPerItem = active ? FLASH_SALE_DISCOUNT : 0;
  var totalDiscount = discountPerItem * totalBags;
  var finalPrice = Math.max(0, total - totalDiscount);

  return {
    original: total,
    promo: finalPrice,
    savings: totalDiscount,
    discountPerItem: discountPerItem,
    totalBags: totalBags,
    isFlashSale: active
  };
}

function isRemoteArea(address) {
  if (!address) return false;
  var addr = address.toLowerCase();
  for (var i = 0; i < REMOTE_PROVINCES.length; i++) {
    if (addr.indexOf(REMOTE_PROVINCES[i]) !== -1) return true;
  }
  return false;
}

function getShippingCost(address, totalBags) {
  if (totalBags >= 3) return 0;
  return isRemoteArea(address) ? REMOTE_SHIPPING : BASE_SHIPPING;
}

function getPatternByName(name) {
  return ALL_PATTERNS.find(function(x) { return x.name === name; });
}

// ==================== STICKER PATTERNS ====================
var STICKER_PRICE = 69;
var STICKER_SHIPPING = 50;
var STICKER_FREE_SHIPPING_QTY = 3;

var STICKER_PATTERNS = [
  {name:'Black Swan',img:'/sticker/BlackSwan.PNG',price:69},
  {name:'Castle purple (Alexa)',img:'/sticker/Castle%20purple%20(Alexa).PNG',price:69},
  {name:'Castle purple (Liana)',img:'/sticker/Castle%20purple%20(Liana)PNG.PNG',price:69},
  {name:'Elina (Rainbow Magic)',img:'/sticker/Elina%20(Rainbow%20Magic).png',price:69},
  {name:'Elina Mermaidia',img:'/sticker/Elina%20Mermaidia.PNG',price:69},
  {name:'Nori Mermaidia',img:'/sticker/Nori%20Mermaidia.PNG',price:69},
  {name:'Nutcracker🍬',img:'/sticker/Nutcracker%F0%9F%8D%AC.PNG',price:69},
  {name:'Rapunzel (Paint)',img:'/sticker/Rapunzel%20(Paint).PNG',price:69},
  {name:'Rapunzel (princess)',img:'/sticker/Rapunzel%20(princess).PNG',price:69},
  {name:'Swan Lake',img:'/sticker/SwanlakePNG.PNG',price:69},
];

function computeStickerPrice(picked) {
  var total = 0;
  var count = 0;
  for (var name in picked) {
    total += STICKER_PRICE * picked[name];
    count += picked[name];
  }
  var shipping = count >= STICKER_FREE_SHIPPING_QTY ? 0 : STICKER_SHIPPING;
  return { total: total, shipping: shipping, grandTotal: total + shipping, count: count };
}

function getStickerByName(name) {
  var list = (typeof window !== 'undefined' && window.STICKER_PATTERNS) || STICKER_PATTERNS;
  return list.find(function(x) { return x.name === name; });
}
