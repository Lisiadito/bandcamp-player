import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimulationService } from "./simulation.service";

describe("SimulationService", () => {
  let service: SimulationService;

  beforeEach(() => {
    service = new SimulationService();
    // Avoid the 10% simulated-error path so batch generation is deterministic.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SIMULATE_COLLECTION_SIZE;
  });

  describe("fetchBatch", () => {
    it("generates albums whose bandcampUrl is a recognisable simulated URL", async () => {
      const batch = await service.fetchBatch(undefined);
      const albumItem = batch.find((item) => item.type === "album");

      expect(albumItem).toBeDefined();
      expect(albumItem!.album!.tracks).toEqual([]); // hydrated lazily
      expect(albumItem!.album!.trackCount).toBeGreaterThan(0);
      expect(service.isSimulatedAlbumUrl(albumItem!.album!.bandcampUrl)).toBe(true);
    });

    it("honours SIMULATE_COLLECTION_SIZE and stops once the target is reached", async () => {
      process.env.SIMULATE_COLLECTION_SIZE = "40";

      const all = [];
      let token: string | undefined;
      // Drain batches until the simulation reports it's done.
      for (let i = 0; i < 10; i++) {
        const batch = await service.fetchBatch(token);
        if (batch.length === 0) break;
        all.push(...batch);
        token = batch[batch.length - 1].token;
      }

      expect(all).toHaveLength(40);
    });
  });

  describe("isSimulatedAlbumUrl", () => {
    it("matches simulated album URLs and rejects real ones", () => {
      expect(service.isSimulatedAlbumUrl("https://sim.local/album/sim-250")).toBe(true);
      expect(service.isSimulatedAlbumUrl("https://artist.bandcamp.com/album/real")).toBe(false);
      expect(service.isSimulatedAlbumUrl("https://bandcamp.com")).toBe(false);
    });
  });

  describe("getAlbumDetails", () => {
    it("hydrates a simulated album URL into a full track list", () => {
      const album = service.getAlbumDetails("https://sim.local/album/sim-250");

      expect(album).not.toBeNull();
      expect(album!.id).toBe("sim-250");
      expect(album!.tracks).toHaveLength(album!.trackCount);
      expect(album!.tracks.length).toBeGreaterThan(0);
      // Track metadata is internally consistent with the album.
      for (const track of album!.tracks) {
        expect(track.album).toBe(album!.title);
        expect(track.artist).toBe(album!.artist);
      }
    });

    it("returns null for a URL that is not a simulated album", () => {
      expect(service.getAlbumDetails("https://artist.bandcamp.com/album/real")).toBeNull();
    });
  });
});
