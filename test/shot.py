import sys, asyncio
from playwright.async_api import async_playwright
from _env import URL, launch_opts
async def main(url, out, w=1260, h=900, wait='DONE', mobile=False, full=True):
    async with async_playwright() as p:
        b = await p.chromium.launch(**launch_opts())
        ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(m.type + ': ' + m.text))
        pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
        await pg.goto(url)
        for _ in range(240):
            t = await pg.title()
            if t.startswith(wait) or t.startswith('ERR'): break
            await pg.wait_for_timeout(250)
        print('TITLE:', await pg.title())
        await pg.screenshot(path=out, full_page=full)
        for l in logs[:30]: print(l)
        await b.close()
if __name__ == '__main__':
    a = sys.argv
    asyncio.run(main(a[1], a[2], int(a[3]) if len(a)>3 else 1260, int(a[4]) if len(a)>4 else 900))
