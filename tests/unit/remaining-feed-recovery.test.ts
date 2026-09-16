import { afterEach, expect, it, vi } from "vitest";
import { CFB } from "xlsx";
import { collectBackfillPage } from "../../backend/backfill-fetch";
import { collect, SOURCES } from "../../backend/index";

const source = SOURCES.find((item) => item.key === "nt-mines")!;
const feature = (id: string, name = "QA Mine &amp; Quarry") =>
  `<Placemark id="generated-1"><name>${name}</name><description><![CDATA[<p>Published mineral occurrence</p>]]></description><ExtendedData><SchemaData><SimpleData name="MODAT_ID">${id}</SimpleData><SimpleData name="NAME">${name}</SimpleData><SimpleData name="STATUS">Operating mine</SimpleData><SimpleData name="COM_MAJOR">Manganese</SimpleData><SimpleData name="PROD_COMME">Third-party production reference</SimpleData></SchemaData></ExtendedData></Placemark>`;
function zip(files: Record<string, string>) {
  const archive = CFB.utils.cfb_new();
  for (const [name, value] of Object.entries(files))
    CFB.utils.cfb_add(archive, name, Buffer.from(value));
  return Buffer.from(
    CFB.write(archive, { type: "buffer", fileType: "zip", compression: true }),
  );
}
const archive = (body: string) =>
  zip({
    "MINESITES_kml.kml": '<kml><Document><Schema id="mines"/></Document></kml>',
    "MINESITES.kml": `<kml><Document>${body}</Document></kml>`,
  });
const json = (body: unknown) => new Response(JSON.stringify(body));
function feed(bytes: Uint8Array, negotiate = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit) => {
      if (String(input).includes("package_show"))
        return json({
          success: true,
          result: {
            resources: [
              { format: "KML", url: "https://example.test/MINESITES_kml.zip" },
            ],
          },
        });
      if (
        negotiate &&
        !new Headers(init.headers)
          .get("accept")
          ?.includes("application/x-zip-compressed")
      )
        return new Response("MIME type not accepted", { status: 406 });
      return new Response(bytes, {
        headers: { "content-type": "application/x-zip-compressed" },
      });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("requests the advertised NT ZIP MIME type and reads feature data rather than schema metadata", async () => {
  feed(archive(feature("5950")), true);
  const page = await collectBackfillPage(source, 0);
  expect(page.rows).toHaveLength(1);
  expect(page.rows[0]).toMatchObject({
    externalId: "5950",
    raw: {
      name: "QA Mine & Quarry",
      MODAT_ID: "5950",
      NAME: "QA Mine & Quarry",
      COM_MAJOR: "Manganese",
      PROD_COMME: "Third-party production reference",
    },
  });
  expect(page.completed).toBe(true);
});

it("uses MODAT identity when different records share the same name", async () => {
  feed(archive(feature("5950", "QA Mine") + feature("6325", "QA Mine")));
  expect(
    (await collectBackfillPage(source, 0)).rows.map((row) => row.externalId),
  ).toEqual(["5950", "6325"]);
});

it("rejects a conflicting duplicate MODAT identity instead of overwriting evidence", async () => {
  feed(archive(feature("5950", "First") + feature("5950", "Changed")));
  await expect(collectBackfillPage(source, 0)).rejects.toThrow(
    "KML_IDENTITY_COLLISION",
  );
});

it("rejects a feature without its published MODAT identifier", async () => {
  feed(archive("<Placemark><name>QA unnamed</name></Placemark>"));
  await expect(collectBackfillPage(source, 0)).rejects.toThrow(
    "KML_IDENTITY_MISSING",
  );
});

it("rejects HTML or an empty schema response instead of reporting a successful empty feed", async () => {
  for (const bytes of [Buffer.from("<html>Unavailable</html>"), archive("")]) {
    feed(bytes);
    await expect(collectBackfillPage(source, 0)).rejects.toThrow(
      /KML_(INVALID_BODY|FEATURES_MISSING)/,
    );
  }
});

it("rejects unsafe paths inside an archive before extracting its feature member", async () => {
  const bytes = archive(feature("5950"));
  // Both headers use a same-length traversal path to keep the ZIP offsets intact.
  const unsafe = Buffer.from(
    bytes.toString("latin1").replaceAll("MINESITES.kml", "../MINES.kmlx"),
    "latin1",
  );
  feed(unsafe);
  await expect(collectBackfillPage(source, 0)).rejects.toThrow(
    "KML_ZIP_UNSAFE_PATH",
  );
});

it("rejects an archive whose declared expansion exceeds the 32MiB cap", async () => {
  const bytes = archive(feature("5950"));
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(33 * 1024 * 1024, central + 24);
  feed(bytes);
  await expect(collectBackfillPage(source, 0)).rejects.toThrow(
    "KML_ZIP_EXPANDED_LIMIT",
  );
});

it("rejects corrupt ZIP data with a mismatched CRC", async () => {
  const bytes = archive(feature("5950"));
  const central = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(0, central + 16);
  feed(bytes);
  await expect(collectBackfillPage(source, 0)).rejects.toThrow(
    /KML_ZIP_(CRC|HEADER)_MISMATCH/,
  );
});

it("rejects additional feature KML files instead of silently selecting a partial dataset", async () => {
  feed(
    zip({
      "MINESITES.kml": `<kml>${feature("5950")}</kml>`,
      "unexpected.kml": `<kml>${feature("6325")}</kml>`,
    }),
  );
  await expect(collectBackfillPage(source, 0)).rejects.toThrow(
    "KML_ZIP_AMBIGUOUS_FEATURES",
  );
});

it("binds continued KML archive pages to the same content snapshot", async () => {
  feed(
    archive(
      Array.from({ length: 101 }, (_, i) => feature(String(1000 + i))).join(""),
    ),
  );
  const first = await collectBackfillPage(source, 0);
  expect(first.rows).toHaveLength(100);
  expect(first.completed).toBe(false);
  const last = await collectBackfillPage(
    source,
    first.next,
    undefined,
    first.context,
  );
  expect(last.rows.map((row) => row.externalId)).toEqual(["1100"]);
  feed(archive(feature("9999")));
  await expect(
    collectBackfillPage(source, first.next, undefined, first.context),
  ).rejects.toThrow("KML_SNAPSHOT_CHANGED");
});

it("requires an explicit restart for old KML cursors without a snapshot", async () => {
  feed(archive(feature("5950")));
  await expect(collectBackfillPage(source, 100)).rejects.toThrow(
    "KML_CHECKPOINT_REQUIRED_RESTART",
  );
});

it("retains native identifiers and review holds in both live and historical collectors", async () => {
  feed(archive(feature("5950")), true);
  const live = await collect(source);
  const historical = await collectBackfillPage(source, 0);
  expect(live.opportunities.map((row) => row.externalId)).toEqual(["5950"]);
  expect(live.opportunities[0].qualityFlags).toEqual(
    expect.arrayContaining(["CONTEXT_ONLY", "SOURCE_RIGHTS_REVIEW_REQUIRED"]),
  );
  expect(historical.rows[0].qualityFlags).toEqual(
    expect.arrayContaining(["CONTEXT_ONLY", "SOURCE_RIGHTS_REVIEW_REQUIRED"]),
  );
});

it("caps actual inflation even when the ZIP metadata understates its size", async () => {
  const bytes = archive(feature("5950"));
  const central = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const local = bytes.readUInt32LE(central + 42);
  bytes.writeUInt32LE(1, central + 24);
  bytes.writeUInt32LE(1, local + 22);
  feed(bytes);
  await expect(collectBackfillPage(source, 0)).rejects.toThrow(
    "KML_ZIP_EXPANDED_LIMIT",
  );
});

it("rejects encrypted or unsupported compression instead of attempting extraction", async () => {
  for (const [offset, value] of [
    [8, 1],
    [10, 99],
  ]) {
    const bytes = archive(feature("5950"));
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt16LE(value, central + offset);
    feed(bytes);
    await expect(collectBackfillPage(source, 0)).rejects.toThrow(
      "KML_ZIP_UNSUPPORTED",
    );
  }
});

it("rejects document type declarations rather than interpreting external entities", async () => {
  feed(
    zip({
      "MINESITES.kml": `<!DOCTYPE kml [<!ENTITY remote SYSTEM "https://example.test/private">]><kml>${feature("5950")}</kml>`,
    }),
  );
  await expect(collectBackfillPage(source, 0)).rejects.toThrow(
    "KML_INVALID_BODY",
  );
});
