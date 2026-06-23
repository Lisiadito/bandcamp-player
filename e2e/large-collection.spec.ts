import { test, expect } from './fixtures';
import { AppHelpers } from './test-helpers';

// ---------------------------------------------------------------------------
// Large-collection coverage.
//
// Unlike every other collection spec (which mocks `collection:fetch` with a
// handful of items), this file launches the app with --simulate-large-collection
// via the `largeCollection` fixture option. The real SimulationService then
// feeds a ~5000-item collection through the actual scraper / SQLite / FTS5 path.
//
// What this exercises that small-collection specs cannot:
//   - virtualization (only ~20 cards mount for 5000 items)
//   - infinite-scroll lazy loading
//   - search/filter over thousands of items
//   - bulk actions over a large filtered subset
//
// Caveats (see CLAUDE.md):
//   - Simulated tracks have an empty streamUrl, so we assert UI/queue state,
//     never real audio playback.
//   - Simulated *albums* point at a generic bandcampUrl and cannot be hydrated
//     (getAlbumDetails has no simulation branch), so bulk-action tests filter to
//     Tracks only — otherwise each album would trigger a real network request.
// ---------------------------------------------------------------------------

test.use({ largeCollection: true });

const COUNT_RE = /^\d[\d,]*\s+items?$/;
// The fixture launches with SIMULATE_COLLECTION_SIZE=1500; anything > 1000 is
// unambiguously "large" (75x the 20-item virtualization window). Keep this
// threshold below the configured size in fixtures.ts.
const LARGE = 1000;

// Reads the "<n> items" header count. Returns 0 if it isn't rendered yet
// (e.g. while the loading state is showing), so it is safe inside expect.poll.
async function readItemCount(window: import('@playwright/test').Page): Promise<number> {
    const loc = window.getByText(COUNT_RE).first();
    if (!(await loc.count())) return 0;
    const txt = (await loc.textContent()) || '';
    return parseInt(txt.replace(/[^\d]/g, ''), 10) || 0;
}

test.describe('Large Collection (simulated)', () => {
    test.beforeEach(async ({ window }) => {
        // Building the simulated collection on first run is slow (batched with
        // simulated latency + a 10% error rate); subsequent runs hit the cache.
        test.setTimeout(150000);

        const loginBtn = window.getByRole('button', { name: 'Login with Bandcamp' });
        if (await loginBtn.isVisible().catch(() => false)) {
            await loginBtn.click();
        }

        const collectionBtn = window.getByRole('button', { name: 'Collection', exact: true });
        await expect(collectionBtn).toBeVisible({ timeout: 20000 });
        await collectionBtn.click();

        // Collection filters/sort persist to settings, so a filter toggled off by a
        // bulk test (or a prior run) would otherwise leak in. Reset to defaults — the
        // store's settings.onChanged listener applies this to the live view reactively.
        await new AppHelpers(window).resetCollectionState();

        // Wait for the simulated collection to finish building/loading.
        await expect.poll(() => readItemCount(window), {
            timeout: 120000,
            intervals: [2000],
        }).toBeGreaterThan(LARGE);
    });

    // -----------------------------------------------------------------------
    // Render & virtualization
    // -----------------------------------------------------------------------

    test('renders a large collection but only mounts a bounded subset (virtualized)', async ({ window }) => {
        const total = await readItemCount(window);
        expect(total).toBeGreaterThan(LARGE);

        const cards = window.getByTestId('album-card');
        await expect(cards.first()).toBeVisible();

        // ItemsGrid renders slice(0, 20) initially. The whole point of
        // virtualization: thousands of items, only a few dozen DOM nodes.
        const mounted = await cards.count();
        expect(mounted).toBeGreaterThan(0);
        expect(mounted).toBeLessThanOrEqual(60);
        expect(mounted).toBeLessThan(total);
    });

    // -----------------------------------------------------------------------
    // Infinite-scroll lazy loading
    // -----------------------------------------------------------------------

    test('infinite scroll mounts more cards as the user scrolls', async ({ window }) => {
        const cards = window.getByTestId('album-card');
        await expect(cards.first()).toBeVisible();
        const initial = await cards.count();

        // Scrolling the last mounted card into view brings the sentinel below it
        // into the viewport, tripping the IntersectionObserver to load +20.
        for (let i = 0; i < 3; i++) {
            await cards.last().scrollIntoViewIfNeeded();
            await window.waitForTimeout(500);
        }

        await expect.poll(() => cards.count(), { timeout: 15000 }).toBeGreaterThan(initial);
    });

    // -----------------------------------------------------------------------
    // Search / filter at scale
    // -----------------------------------------------------------------------

    test('search narrows a large collection and clearing restores it', async ({ window }) => {
        const total = await readItemCount(window);
        expect(total).toBeGreaterThan(LARGE);

        const search = window.getByPlaceholder('Search your music...');
        await search.fill('Artist 50');
        await window.waitForTimeout(500);

        const narrowed = await readItemCount(window);
        expect(narrowed).toBeGreaterThan(0);
        expect(narrowed).toBeLessThan(total);

        // Clearing the query restores the full collection.
        await search.fill('');
        await expect.poll(() => readItemCount(window), { timeout: 15000 }).toBeGreaterThan(LARGE);
    });

    test('a non-matching search over thousands of items shows the empty state', async ({ window }) => {
        const search = window.getByPlaceholder('Search your music...');
        await search.fill('zzz-no-such-item-xyz-12345');
        await window.waitForTimeout(500);

        await expect(window.getByTestId('album-card')).toHaveCount(0);
        await expect(window.locator('text=/No results for/')).toBeVisible();
    });

    // -----------------------------------------------------------------------
    // Bulk actions over a large filtered subset
    // -----------------------------------------------------------------------

    test('bulk "Add to Queue" enqueues a large track subset', async ({ window }) => {
        const helpers = new AppHelpers(window);

        // Tracks only: simulated albums cannot be hydrated (no network in E2E).
        await helpers.openCollectionFilters();
        await helpers.toggleCollectionFilter('filter-albums-btn');

        const search = window.getByPlaceholder('Search your music...');
        await search.click(); // also dismisses the filter dropdown
        await search.fill('Artist 50');
        await window.waitForTimeout(500);

        const subset = await readItemCount(window);
        expect(subset).toBeGreaterThan(0);

        const bulkBtn = window.getByTitle('Bulk actions for current view');
        await expect(bulkBtn).toBeVisible();
        await bulkBtn.click();

        const addToQueue = window.locator('button', { hasText: 'Add to Queue' }).first();
        await expect(addToQueue).toBeVisible({ timeout: 3000 });
        await addToQueue.click();

        // Wait for the bulk operation to finish (progress badge "<cur>/<total>" gone).
        await expect(window.locator('text=/^\\d+\\/\\d+$/')).toHaveCount(0, { timeout: 30000 });

        const queueBtn = window.locator('div[class*="playerBar"]').getByTitle('Queue', { exact: true });
        await queueBtn.click();
        await expect(window.getByRole('heading', { name: 'Queue', level: 2 })).toBeVisible({ timeout: 5000 });

        const queueItems = window.locator('li[class*="item"]');
        await expect(queueItems.first()).toBeVisible({ timeout: 10000 });
        expect(await queueItems.count()).toBeGreaterThan(0);
    });

    test('bulk "Add to Queue" lazily hydrates album tracks at scale', async ({ window }) => {
        const helpers = new AppHelpers(window);

        // Albums only: each simulated album has empty `tracks` until hydrated via
        // getAlbumDetails (now served synthetically — 10 tracks per album).
        await helpers.openCollectionFilters();
        await helpers.toggleCollectionFilter('filter-tracks-btn');

        const search = window.getByPlaceholder('Search your music...');
        await search.click(); // also dismisses the filter dropdown
        await search.fill('Album 250');
        await window.waitForTimeout(500);

        const albumCount = await readItemCount(window);
        expect(albumCount).toBeGreaterThan(0);

        const bulkBtn = window.getByTitle('Bulk actions for current view');
        await expect(bulkBtn).toBeVisible();
        await bulkBtn.click();

        const addToQueue = window.locator('button', { hasText: 'Add to Queue' }).first();
        await expect(addToQueue).toBeVisible({ timeout: 3000 });
        await addToQueue.click();

        // Hydration is sequential (one getAlbumDetails per album), so allow time.
        await expect(window.locator('text=/^\\d+\\/\\d+$/')).toHaveCount(0, { timeout: 30000 });

        const queueBtn = window.locator('div[class*="playerBar"]').getByTitle('Queue', { exact: true });
        await queueBtn.click();
        await expect(window.getByRole('heading', { name: 'Queue', level: 2 })).toBeVisible({ timeout: 5000 });

        const queueItems = window.locator('li[class*="item"]');
        await expect(queueItems.first()).toBeVisible({ timeout: 10000 });
        // Each album hydrates into multiple tracks, so the queue must hold more
        // entries than there were albums — proof the lazy hydration loop ran.
        expect(await queueItems.count()).toBeGreaterThan(albumCount);
    });

    test('bulk "Play All" over a large track subset starts playback', async ({ window }) => {
        await expect(window.locator('text=No track playing')).toBeVisible({ timeout: 10000 });

        const helpers = new AppHelpers(window);
        await helpers.openCollectionFilters();
        await helpers.toggleCollectionFilter('filter-albums-btn');

        const search = window.getByPlaceholder('Search your music...');
        await search.click();
        await search.fill('Artist 50');
        await window.waitForTimeout(500);
        expect(await readItemCount(window)).toBeGreaterThan(0);

        const bulkBtn = window.getByTitle('Bulk actions for current view');
        await expect(bulkBtn).toBeVisible();
        await bulkBtn.click();

        const playAll = window.locator('button', { hasText: 'Play All' }).first();
        await expect(playAll).toBeVisible({ timeout: 3000 });
        await playAll.evaluate(el => (el as HTMLButtonElement).click());

        // A track becomes current, so the idle "No track playing" label disappears.
        await expect(window.locator('text=No track playing')).not.toBeVisible({ timeout: 20000 });
    });
});
