import { Album, CollectionItem, Track } from '../../shared/types';

export class SimulationService {
    private readonly DEFAULT_SIMULATION_TARGET = 5000;
    private readonly BATCH_SIZE = 20;
    private readonly ERROR_RATE = 0.10; // 10% chance of error
    private readonly ALBUM_TRACK_COUNT = 10;

    // Total simulated item count. Defaults to 5000 (used by `npm run dev:large` to
    // stress-test scalability); overridable via SIMULATE_COLLECTION_SIZE so E2E can
    // request a smaller-but-still-large collection for a faster cold build.
    private get simulationTarget(): number {
        const raw = parseInt(process.env.SIMULATE_COLLECTION_SIZE || '', 10);
        return Number.isFinite(raw) && raw > 0 ? raw : this.DEFAULT_SIMULATION_TARGET;
    }

    shouldSimulate(): boolean {
        const hasFlag = process.argv.includes('--simulate-large-collection');
        const hasEnv = process.env.SIMULATE_LARGE_COLLECTION === 'true';
        if (hasFlag || hasEnv) {
            console.log(`[SIMULATION] Simulation mode active (Flag: ${hasFlag}, Env: ${hasEnv})`);
            return true;
        }
        return false;
    }

    // --- Synthetic field helpers (shared between collection items and album details) ---
    private artistName(itemId: number): string {
        return `Artist ${Math.floor(itemId / 20)}`;
    }
    private artistId(itemId: number): string {
        return `artist-${Math.floor(itemId / 20)}`;
    }
    private artwork(itemId: number): string {
        return `https://picsum.photos/seed/bc-${itemId}/300/300`;
    }
    // A distinctive, non-routable URL so we can recognise a simulated album and
    // never hit the real network. The album id is encoded for later hydration.
    private albumUrl(itemId: number): string {
        return `https://sim.local/album/sim-${itemId}`;
    }

    async fetchBatch(lastToken: string | undefined): Promise<CollectionItem[]> {
        // Simulate network latency (reduced for faster loading while still simulating async)
        await new Promise(resolve => setTimeout(resolve, 20));

        // Simulate network error
        if (Math.random() < this.ERROR_RATE) {
            console.log('[SIMULATION] Simulating network error...');
            throw new Error('Simulated network error');
        }

        // Parse index from token
        let currentIndex = 0;
        if (lastToken && lastToken.startsWith('sim-')) {
            currentIndex = parseInt(lastToken.split('-')[1], 10);
        }

        if (currentIndex >= this.simulationTarget) {
            console.log('[SIMULATION] Reached target size, stopping.');
            return [];
        }

        const dummyItems: CollectionItem[] = [];
        for (let i = 0; i < this.BATCH_SIZE; i++) {
            const itemId = currentIndex + i + 1;
            const isAlbum = itemId % 5 === 0; // Every 5th item is an album
            const type = isAlbum ? 'album' : 'track';

            const item: CollectionItem = {
                id: `sim-${itemId}`,
                type,
                token: `sim-${itemId}:${type}::`,
                purchaseDate: new Date(Date.now() - (itemId * 3600000)).toISOString(), // Older dates for higher IDs
            };

            if (isAlbum) {
                item.album = {
                    id: `sim-${itemId}`,
                    title: `Simulated Album ${itemId}`,
                    artist: this.artistName(itemId),
                    artistId: this.artistId(itemId),
                    artworkUrl: this.artwork(itemId),
                    // Collection albums load with no tracks; hydrated lazily via getAlbumDetails.
                    bandcampUrl: this.albumUrl(itemId),
                    tracks: [],
                    trackCount: this.ALBUM_TRACK_COUNT,
                };
            } else {
                item.track = {
                    id: `sim-${itemId}`,
                    title: `Simulated Track ${itemId}`,
                    artist: this.artistName(itemId),
                    artistId: this.artistId(itemId),
                    album: `Simulated Album ${Math.floor(itemId / 10)}`,
                    duration: 180 + (itemId % 60),
                    artworkUrl: this.artwork(itemId),
                    streamUrl: '',
                    bandcampUrl: this.albumUrl(itemId),
                    isCached: false,
                };
            }

            dummyItems.push(item);
        }

        console.log(`[SIMULATION] Generated batch starting at ${currentIndex + 1}`);
        return dummyItems;
    }

    /** True if the URL was produced by this service (see albumUrl). */
    isSimulatedAlbumUrl(url: string): boolean {
        return /^https:\/\/sim\.local\/album\/sim-\d+$/.test(url);
    }

    /**
     * Synthetic album details for a simulated album URL. Mirrors the real
     * getAlbumDetails contract (returns an Album with a populated `tracks`
     * array) so the lazy album-hydration path can be exercised without network.
     * Tracks have an empty streamUrl — UI/queue state only, no real audio.
     */
    getAlbumDetails(albumUrl: string): Album | null {
        const match = albumUrl.match(/sim-(\d+)$/);
        if (!match) return null;
        const itemId = parseInt(match[1], 10);

        const tracks: Track[] = Array.from({ length: this.ALBUM_TRACK_COUNT }, (_, i) => {
            const trackNum = i + 1;
            return {
                id: `sim-${itemId}-t${trackNum}`,
                title: `Simulated Album ${itemId} - Track ${trackNum}`,
                artist: this.artistName(itemId),
                artistId: this.artistId(itemId),
                album: `Simulated Album ${itemId}`,
                duration: 180 + ((itemId + trackNum) % 60),
                artworkUrl: this.artwork(itemId),
                streamUrl: '',
                bandcampUrl: albumUrl,
                isCached: false,
            };
        });

        return {
            id: `sim-${itemId}`,
            title: `Simulated Album ${itemId}`,
            artist: this.artistName(itemId),
            artistId: this.artistId(itemId),
            artworkUrl: this.artwork(itemId),
            bandcampUrl: albumUrl,
            tracks,
            trackCount: this.ALBUM_TRACK_COUNT,
        };
    }
}

export const simulationService = new SimulationService();
