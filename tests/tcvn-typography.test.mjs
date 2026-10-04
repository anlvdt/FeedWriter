// Chuẩn hoá chữ, số, đơn vị theo TCVN 6909:2001 (Unicode NFC) và
// TCVN 7870-1:2010 (ký hiệu đơn vị). House style: dấu chấm hàng nghìn,
// dấu phẩy thập phân, "50%" viết liền.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const utils = readFileSync(new URL("../utils.js", import.meta.url), "utf8");
const context = vm.createContext({ console });
vm.runInContext(utils, context);
vm.runInContext(
  background.slice(background.indexOf("function computeNgramOverlap("), background.indexOf("async function handleStream(")),
  context,
);
const tcvn = (text) => { context.input = text; return vm.runInContext("normalizeTcvnTypography(input)", context); };
const post = (text) => { context.input = text; return vm.runInContext('postProcessOutput(input, "", "summary").text', context); };

describe("TCVN unit symbols", () => {
  it("puts a space between number and unit and fixes symbol casing", () => {
    assert.equal(
      tcvn("Pin 5000mAh, sạc 65W, màn 120hz, chip 3,5Ghz, 16GB RAM, nặng 1,2Kg, chạy 60km/h, nhiệt độ 30°C, phủ 20m2."),
      "Pin 5000 mAh, sạc 65 W, màn 120 Hz, chip 3,5 GHz, 16 GB RAM, nặng 1,2 kg, chạy 60 km/h, nhiệt độ 30 °C, phủ 20 m².",
    );
  });

  it("keeps percent attached and the plane-angle degree unspaced", () => {
    assert.equal(tcvn("tăng 50 % trong góc 30°"), "tăng 50% trong góc 30°");
  });

  it("handles ranges but leaves identifiers alone", () => {
    assert.equal(tcvn("bản 10-20GB"), "bản 10-20 GB");
    assert.equal(tcvn("RTX4090 với DDR5-6000MHz"), "RTX4090 với DDR5-6000MHz");
    assert.equal(tcvn("Windows 11 có 2W"), "Windows 11 có 2 W");
    assert.equal(tcvn("xem https://example.com/a?size=16GB và `run --mem 8gb`"), "xem https://example.com/a?size=16GB và `run --mem 8gb`");
  });
});

describe("TCVN Vietnamese text", () => {
  it("normalizes decomposed Unicode to NFC", () => {
    const decomposed = "Việt Nam";
    assert.equal(tcvn(decomposed), "Việt Nam");
  });

  it("places tone marks consistently on open oa/oe/uy syllables", () => {
    assert.equal(tcvn("hoà bình, khoẻ mạnh, thuỷ điện, tuỳ chọn"), "hòa bình, khỏe mạnh, thủy điện, tùy chọn");
    assert.equal(tcvn("quý, hoàn thành, ngoài, khuya, Huỳnh"), "quý, hoàn thành, ngoài, khuya, Huỳnh");
  });

  it("fixes spacing around punctuation", () => {
    assert.equal(tcvn("Lưu ý : giá 1,5 triệu ,áp dụng  từ nay !"), "Lưu ý: giá 1,5 triệu, áp dụng từ nay!");
  });
});

describe("headline uppercase keeps unit symbols", () => {
  it("does not turn mAh/Hz/km into MAH/HZ/KM", () => {
    const out = post("Điện thoại pin 5000mAh sạc 65W màn 120Hz\n\nMáy có pin 5.000 mAh.");
    assert.match(out.split("\n")[0], /PIN 5000 mAh SẠC 65 W MÀN 120 Hz/);
  });
});

describe("dates", () => {
  it("removes spaces around the slash in dates and fractions", () => {
    assert.equal(tcvn("Từ ngày 2 /11, hạn 2 / 11 và 2/ 11/2026; tỷ lệ 1 /2."), "Từ ngày 2/11, hạn 2/11 và 2/11/2026; tỷ lệ 1/2.");
  });

  it("leaves URLs and non-numeric slashes alone", () => {
    assert.equal(tcvn("xem https://x.com/a/status/2 và và/hoặc"), "xem https://x.com/a/status/2 và và/hoặc");
  });
});
