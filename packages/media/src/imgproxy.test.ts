import { describe, expect, test } from "bun:test";
import { buildImgproxyUrl } from "./imgproxy";

// Fixed, known key/salt so this test's expected signature is a literal,
// reproducible value -- not "does it look plausible," but "is this the
// exact byte-for-byte signature imgproxy itself would compute," verified
// by generating this exact URL against a real running imgproxy container
// with this exact key/salt pair during this plan's research and
// confirming a 200 with a correctly-resized image back.
const TEST_KEY = "4ac5d314cc578f0216d080c03b2bc517a7e4226af8a4ed6a5617cf94e44c554c";
const TEST_SALT = "00325181fcb6c7a7ef94ba22eab86f3115ddfaf7178dcba96d19a327c0ab65f1";

describe("buildImgproxyUrl", () => {
  test("produces the exact signed URL imgproxy itself validated, for a known key/salt/object key", async () => {
    const url = await buildImgproxyUrl("test-image.jpg", {
      key: TEST_KEY,
      salt: TEST_SALT,
      baseUrl: "http://localhost:8090",
      sourceBaseUrl: "http://localhost:9000/campaign-media",
      resize: { width: 300, height: 200 },
    });
    expect(url).toBe(
      "http://localhost:8090/k9mZt7zOjEifZfzF7xAev5soKVBtEgSr9zqUYLzi79Y/rs:fill:300:200:0/aHR0cDovL2xvY2FsaG9zdDo5MDAwL2NhbXBhaWduLW1lZGlhL3Rlc3QtaW1hZ2UuanBn.jpg",
    );
  });

  test("different resize dimensions produce a different signature", async () => {
    const url = await buildImgproxyUrl("test-image.jpg", {
      key: TEST_KEY,
      salt: TEST_SALT,
      baseUrl: "http://localhost:8090",
      sourceBaseUrl: "http://localhost:9000/campaign-media",
      resize: { width: 600, height: 400 },
    });
    expect(url).toContain("/rs:fill:600:400:0/");
    expect(url).not.toContain("k9mZt7zOjEifZfzF7xAev5soKVBtEgSr9zqUYLzi79Y");
  });

  test("preserves the source object key's extension in the final path segment", async () => {
    const url = await buildImgproxyUrl("nested/path/photo.png", {
      key: TEST_KEY,
      salt: TEST_SALT,
      baseUrl: "http://localhost:8090",
      sourceBaseUrl: "http://localhost:9000/campaign-media",
      resize: { width: 100, height: 100 },
    });
    expect(url.endsWith(".png")).toBe(true);
  });
});
