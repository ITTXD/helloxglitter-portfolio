/**
 * Client-side QR scanner - optimized
 */
function scanQRFromFile(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        // QR only needs ~500px to be readable
        var canvas = document.createElement('canvas');
        var maxDim = 500;
        var w = img.width, h = img.height;
        if (w > maxDim && w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        var imageData = ctx.getImageData(0, 0, w, h);
        var code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
        resolve(code ? code.data : null);
      };
      img.onerror = function() { reject(new Error('ไม่สามารถโหลดรูปได้')); };
      img.src = e.target.result;
    };
    reader.onerror = function() { reject(new Error('อ่านไฟล์ไม่สำเร็จ')); };
    reader.readAsDataURL(file);
  });
}
