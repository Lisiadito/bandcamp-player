import { _electron as electron, test as base, ElectronApplication, Page } from '@playwright/test';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

type AppFixtures = {
    electronApp: ElectronApplication;
    window: Page;
    // Opt-in option: launch the app with --simulate-large-collection so the
    // real SimulationService feeds a 5000-item collection. Defaults to false,
    // so existing specs are unaffected. Enable per-spec via test.use({ largeCollection: true }).
    largeCollection: boolean;
};

export const test = base.extend<AppFixtures>({
    largeCollection: [false, { option: true }],
    electronApp: async ({ largeCollection }, use, testInfo) => {
        // Keep large-collection runs in a separate user-data-dir so the simulated
        // SQLite cache never leaks into the small-collection specs sharing a worker.
        const dirSuffix = largeCollection ? '-large' : '';
        const args = [
            join(__dirname, '../dist/main/main.js'),
            `--user-data-dir=${join(__dirname, '../temp-test-data', testInfo.workerIndex.toString() + dirSuffix)}`
        ];
        if (largeCollection) {
            args.push('--simulate-large-collection');
        }
        const electronApp = await electron.launch({
            args,
            env: {
                ...process.env,
                NODE_ENV: 'production',
                E2E_TEST: 'true',
                REMOTE_PORT: '0',
                // Smaller-but-still-large collection for E2E: faster cold build than the
                // 5000-item dev:large default, while staying well above the test threshold.
                ...(largeCollection ? { SIMULATE_COLLECTION_SIZE: '1500' } : {}),
            },
        });

        await use(electronApp);

        try { await electronApp.close(); } catch { /* App may already be closed by test */ }
    },
    window: async ({ electronApp }, use, testInfo) => {
        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');

        // Start V8 coverage for the renderer process
        await window.coverage.startJSCoverage();

        // Wait for the UI to be interactive (either Login or Main Layout)
        const loginBtn = window.getByRole('button', { name: 'Login with Bandcamp' });
        const collectionBtn = window.getByRole('button', { name: 'Collection', exact: true });
        await loginBtn.or(collectionBtn).waitFor();

        await use(window);

        // Stop coverage and save results
        const testName = testInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();

        try {
            const coverage = await window.coverage.stopJSCoverage();

            // Save raw coverage to a directory
            const coverageDir = join(__dirname, '../coverage-v8');
            if (!existsSync(coverageDir)) {
                mkdirSync(coverageDir, { recursive: true });
            }

            // Generate a unique filename for this test's coverage
            const filename = `${testName}_${testInfo.workerIndex}.json`;
            writeFileSync(join(coverageDir, filename), JSON.stringify(coverage, null, 2));
        } catch (err: any) {
            if (err.message && err.message.includes('Target page, context or browser has been closed')) {
                // Ignore silently: expected when a test closes the window or restarts the app
            } else {
                console.error(`ERROR in stopJSCoverage: ${err}`);
            }
        }
    },
});

export { expect } from '@playwright/test';
