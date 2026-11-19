"""Decodes the PNGs written by `node test/qrtest.js` with OpenCV and checks them."""
import cv2, pathlib
here = pathlib.Path(__file__).parent
cases = ['https://claude.ai/artifact/0b8f2c1e-1234-4abc-9def-001122334455#table-12', 'upi://pay?pa=kaapimarble@okaxis&pn=Kaapi%20%26%20Marble&am=231.00&cu=INR&tn=Order%20KM-1043&tr=KM-1043', 'KM-1043', 'Hello ₹ café — ünïcödé ✓', 'x' * 300]
d = cv2.QRCodeDetector()
for i, c in enumerate(cases):
    val, _, _ = d.detectAndDecode(cv2.imread(str(here / f'qr{i}.png')))
    print(i, 'OK' if val == c else 'MISMATCH', repr(val[:50]))
