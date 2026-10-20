"""Read-only PDF validation and Poppler previews. Uses the existing Python runtime.

python scripts/inspect-vector-pdf-prototype.py --poppler /path/to/pdftoppm
"""
import argparse
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument("--poppler", default="pdftoppm")
args = parser.parse_args()
directory = Path("output/build31/vector-pdf-prototype")
measurements = json.loads((directory / "measurements.json").read_text(encoding="utf-8"))
results = []
for measured in measurements["measurements"]:
    label, count = measured["label"], measured["count"]
    for mode in ["vector", "image"]:
        filename = directory / f"{label}-{mode}.pdf"
        reader = PdfReader(filename, strict=True)
        assert len(reader.pages) == count
        fonts, image_refs = [], set()
        for page in reader.pages:
            assert abs(float(page.mediabox.width) - 841.89) < .02
            assert abs(float(page.mediabox.height) - 595.28) < .02
            for obj in page["/Resources"].get("/XObject", {}).values():
                if obj.get_object().get("/Subtype") == "/Image":
                    image_refs.add((obj.idnum, obj.generation))
        images = len(image_refs)
        if mode == "vector":
            assert filename.stat().st_size < (400 if count == 1 else 600) * 1024
            assert images == 0
            for font_ref in reader.pages[0]["/Resources"]["/Font"].values():
                font = font_ref.get_object()
                assert font["/Subtype"] == "/Type0" and font["/Encoding"] == "/Identity-H"
                unicode_map = font["/ToUnicode"].get_data()
                assert b"beginbfchar" in unicode_map
                descendant = font["/DescendantFonts"][0].get_object()
                assert descendant["/Subtype"] == "/CIDFontType2"
                stream = descendant["/FontDescriptor"]["/FontFile2"]
                assert stream.get_data()[:4] == b"\0\1\0\0"
                assert len(stream.get_data()) == stream["/Length1"]
                fonts.append({"name": str(font["/BaseFont"]), "compressedBytes": len(stream._data),
                              "uncompressedBytes": len(stream.get_data()), "toUnicodeBytes": len(unicode_map)})
            extracted = "".join(p.extract_text() for p in reader.pages)
            for expected in ["髙橋", "﨑山", "山田", "花子", "大道具Ａ", "円形台", "ななめ", f"シーン{count}"]:
                assert expected in extracted, f"Missing extracted text: {expected}"
        else:
            assert images >= count
        for page_number in sorted({1, count}):
            suffix = "render" if page_number == 1 else "last-render"
            target = directory / f"{label}-{mode}-{suffix}"
            subprocess.run([args.poppler, "-f", str(page_number), "-singlefile", "-scale-to", "1500",
                            "-png", str(filename), str(target)], check=True, capture_output=True)
        results.append({"file": filename.name, "bytes": filename.stat().st_size, "pages": count,
                        "images": images, "embeddedFonts": fonts, "valid": True})

# A4 diagnostic using the same common font in CSS, isolating font migration from geometry.
reference = Image.open(directory / "festival-1-same-font-browser.png").convert("RGB")
page = Image.new("RGB", (1500, 1061), "white")
scale = min((841.89 - 40) / reference.width, (595.28 - 40) / reference.height)
w, h = round(reference.width * scale * 1500 / 841.89), round(reference.height * scale * 1500 / 841.89)
page.paste(reference.resize((w, h), Image.Resampling.LANCZOS), ((1500 - w) // 2, (1061 - h) // 2))
page.save(directory / "festival-1-same-font-a4-reference.png")
contact = Image.new("RGB", (1800, 3 * 660), "#eeeeee")
draw = ImageDraw.Draw(contact)
for row, measured in enumerate(measurements["measurements"]):
    for column, mode in enumerate(["image", "vector"]):
        name = f"{measured['label']}-{mode}"
        img = Image.open(directory / f"{name}-render.png").convert("RGB")
        img.thumbnail((890, 625))
        contact.paste(img, (column * 900, row * 660 + 30))
        draw.text((column * 900 + 10, row * 660 + 8), name, fill="black")
contact.save(directory / "comparison-contact-sheet.png")
(directory / "pdf-inspection.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(results, ensure_ascii=False, indent=2))
