"""Shared settings for the Playwright end-to-end tests.
Run from anywhere:  python3 test/e2e_staff.py
Needs:  pip install playwright opencv-python  &&  playwright install chromium
Set CHROME_PATH to use an installed Chrome instead of Playwright's Chromium."""
import os, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
os.chdir(ROOT)                      # so 'shots/...' and 'test/...' paths work
(ROOT / 'shots').mkdir(exist_ok=True)
URL = (ROOT / 'dist' / 'demo.html').as_uri()   # combined build: customer and staff routes in one page
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--allow-file-access-from-files']
def launch_opts():
    o = {'args': ARGS}
    if os.environ.get('CHROME_PATH'):
        o['executable_path'] = os.environ['CHROME_PATH']
    return o
