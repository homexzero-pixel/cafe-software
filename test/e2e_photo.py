import asyncio
from playwright.async_api import async_playwright
from _env import URL, launch_opts
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**launch_opts())
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        logs = []
        pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
        await pg.goto(URL + '#table-2'); await pg.wait_for_timeout(4000)
        await pg.screenshot(path='shots/p0_hero.png', clip={'x':0,'y':0,'width':390,'height':290})
        await pg.goto(URL + '#ar'); await pg.wait_for_timeout(2000)
        await pg.set_input_files('input[data-photo]', 'test/table_photo.jpg')
        await pg.wait_for_timeout(3000)
        await pg.screenshot(path='shots/p1_photo.png')
        # swipe right twice (next dishes)
        for i in range(2):
            await pg.mouse.move(100, 450); await pg.mouse.down(); await pg.mouse.move(180, 452, steps=3); await pg.mouse.move(300, 455, steps=3); await pg.mouse.up()
            await pg.wait_for_timeout(1500)
        print('card:', (await pg.inner_text('.ar-card .nm')).strip(), '|', (await pg.inner_text('.ar-card .count')).strip())
        await pg.screenshot(path='shots/p2_photo_swiped.png')
        # tap the table to move the dish
        await pg.mouse.click(260, 560); await pg.wait_for_timeout(1200)
        await pg.click('.ar-cats [data-cat="Mains"]'); await pg.wait_for_timeout(1800)
        await pg.screenshot(path='shots/p3_photo_mains.png')
        print('LOGS', logs)
        await ctx.close(); await b.close()
asyncio.run(main())
