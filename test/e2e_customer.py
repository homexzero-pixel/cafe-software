import asyncio, sys
from playwright.async_api import async_playwright
from _env import URL, launch_opts
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**launch_opts())
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(m.type + ': ' + m.text) if m.type in ('error','warning') and 'GPU stall' not in m.text else None)
        pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
        await pg.goto(URL + '#welcome')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path='shots/c0_welcome.png')
        await pg.goto(URL + '#table-3')
        await pg.wait_for_timeout(6000)
        await pg.screenshot(path='shots/c1_menu.png')
        await pg.screenshot(path='shots/c1_menu_full.png', full_page=True)
        # add two items
        await pg.click('button[data-inc="cappuccino"]')
        await pg.click('button[data-inc="croissant"]')
        await pg.click('button[data-inc="cappuccino"]')
        await pg.wait_for_timeout(500)
        await pg.screenshot(path='shots/c2_added.png')
        # dish sheet
        await pg.evaluate("document.querySelector('button.open[data-open=kulhad-chai]').scrollIntoView({block:'center'})")
        await pg.wait_for_timeout(300)
        await pg.click('button.open[data-open="kulhad-chai"]', force=True)
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path='shots/c3_sheet.png')
        await pg.click('[data-sinc]')
        await pg.click('[data-sadd]')
        await pg.wait_for_timeout(600)
        print('LOGS1', logs[:20]); logs.clear()
        await ctx.close(); await b.close()
asyncio.run(main())
