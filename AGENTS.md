# Egypt Cinema — إرشادات

موقع أفلام ثابت (static) بدون خادم:

- `index.html` — الهيكل
- `style.css` — التصميم
- `app.js` — كل المنطق

لا يوجد npm / build / dependencies. أعد فتح `index.html` مباشرة، أو استضف المجلد على أي web server ثابت (Netlify / GitHub Pages...).

عند تعديل `app.js`، تأكد من سلامة الصيغة: `node --check app.js`