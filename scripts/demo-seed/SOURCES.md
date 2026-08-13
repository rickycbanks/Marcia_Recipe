# Demo seed media sources

Every image in `scripts/demo-seed` is a **WebP re-encode** of a free Pexels
photo, downloaded from the stable `images.pexels.com` CDN URL and processed
with `sharp` (rotate → resize to max 1600 px, `fit: inside` → WebP quality 80)
mirroring `MEDIA_LIMITS` in `src/lib/validation/constants.ts`. Width, height
and bytes in the recipe documents are the actual dimensions and size of the
committed `.webp` files.

## Provenance

| Media id | Pexels photo id | Recipe | File | Role | Creator (Pexels handle) | Stable photo page | Bytes | Width × Height | sha256 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 00000000-0000-4000-8000-000000000100 | [7144716](https://www.pexels.com/photo/7144716/) | Blueberry Buttermilk Pancakes | 00000000-0000-4000-8000-000000000100.webp | primary | gabby-k (Gabby K) | https://www.pexels.com/photo/delicious-pancakes-on-plate-with-blueberries-7144716/ | 30596 | 1067 × 1600 | ef93dc9c016151501034e6a29ba5a4a4da6dbd81dd072fb232edfe3f5020dbd8 |
| 00000000-0000-4000-8000-000000000101 | [12326493](https://www.pexels.com/photo/12326493/) | Blueberry Buttermilk Pancakes | 00000000-0000-4000-8000-000000000101.webp | gallery | wendywei (Wendy Wei) | https://www.pexels.com/photo/photograph-of-pancakes-with-blueberries-12326493/ | 254688 | 1200 × 1600 | f38dddee502bbba2e0314d1b0eb4f3e09b2c95c3960c9825ba1f8a87ec2c4be8 |
| 00000000-0000-4000-8000-000000000102 | [7936963](https://www.pexels.com/photo/7936963/) | Avocado, Egg & Chili Toast | 00000000-0000-4000-8000-000000000102.webp | primary | nicola-barts | https://www.pexels.com/photo/eggs-on-bread-7936963/ | 68228 | 1067 × 1600 | 4a417a343d0cde14788807a31bac5739daeb2b3d6d07e840f6565a0aebcb25de |
| 00000000-0000-4000-8000-000000000103 | [6066051](https://www.pexels.com/photo/6066051/) | Lemony Chickpea Crunch Salad | 00000000-0000-4000-8000-000000000103.webp | primary | alesiakozik | https://www.pexels.com/photo/close-up-shot-of-a-chickpea-salad-6066051/ | 86858 | 1068 × 1600 | adb0aa4ff3c35867d4eb3615f8bb7d2a7bce1c32a1cc62a8f29fc312ce8a42ae |
| 00000000-0000-4000-8000-000000000104 | [11047125](https://www.pexels.com/photo/11047125/) | Roast Chicken Pesto Ciabatta | 00000000-0000-4000-8000-000000000104.webp | primary | fernando-capetillo | https://www.pexels.com/photo/tomato-mozzarella-sandwich-11047125/ | 227662 | 1600 × 1040 | 31f472888f3545181174e7b82972de2246cfb14b5ce898e1e1f6f0232f45db86 |
| 00000000-0000-4000-8000-000000000105 | [14515103](https://www.pexels.com/photo/14515103/) | Sheet-Pan Lemon Herb Salmon & Vegetables | 00000000-0000-4000-8000-000000000105.webp | primary | vidalbalielojrfotografia | https://www.pexels.com/photo/salmon-dish-on-a-ceramic-plate-14515103/ | 71644 | 1600 × 1067 | 3bc305eff1a8624b1f7ceed94064b5bcd614242105ffba47638b577c1c38f228 |
| 00000000-0000-4000-8000-000000000106 | [31065719](https://www.pexels.com/photo/31065719/) | Sheet-Pan Lemon Herb Salmon & Vegetables | 00000000-0000-4000-8000-000000000106.webp | gallery | didsss | https://www.pexels.com/photo/fresh-salmon-with-peppers-mushrooms-and-pumpkin-seeds-31065719/ | 164214 | 900 × 1600 | 9c91b3ada9598218ee7194393cdbe4634e5af353d72183f6c3f633a356a6124a |
| 00000000-0000-4000-8000-000000000107 | [34380282](https://www.pexels.com/photo/34380282/) | Creamy Mushroom Rigatoni | 00000000-0000-4000-8000-000000000107.webp | primary | farklimavi | https://www.pexels.com/photo/delicious-pasta-with-creamy-mushroom-sauce-34380282/ | 206722 | 1600 × 1067 | 0cfa43f2dc3a37050f1cc5a9fd1f5922baec125ed529d085a8ee2550e6849486 |
| 00000000-0000-4000-8000-000000000108 | [32733936](https://www.pexels.com/photo/32733936/) | Dark Chocolate Raspberry Tart | 00000000-0000-4000-8000-000000000108.webp | primary | silviopelegrin | https://www.pexels.com/photo/delicious-raspberry-chocolate-tart-with-nuts-32733936/ | 67290 | 1600 × 1067 | 43af75aca02e69aec8e54d164f21499841713eb1661619c64631e9550d1ec2b6 |
| 00000000-0000-4000-8000-000000000109 | [32802352](https://www.pexels.com/photo/32802352/) | Dark Chocolate Raspberry Tart | 00000000-0000-4000-8000-000000000109.webp | gallery | manish-jain | https://www.pexels.com/photo/gourmet-chocolate-tart-with-fresh-raspberries-32802352/ | 59174 | 1067 × 1600 | 868c8fda13c84fb889edb7b76d5e1fcc8e113056064c69e0cab91d09ab5c0029 |
| 00000000-0000-4000-8000-00000000010a | [3301907](https://www.pexels.com/photo/3301907/) | Honey Vanilla Panna Cotta with Berries | 00000000-0000-4000-8000-00000000010a.webp | primary | mattia-marca (Mattia Marca) | https://www.pexels.com/photo/baked-dessert-3301907/ | 68904 | 1600 × 1067 | 0c910d8c184145128bd8223722f93901eca3d34d2212644ce0c1c6f926911b97 |

### License

All photos are used under the **Pexels License** — see
[https://www.pexels.com/license/](https://www.pexels.com/license/). Free to use with no attribution required;
Pexels does not allow resale or redistribution of unmodified photos. The
creator handles listed above were recovered from Pexels search-result download
filenames captured during research; where a handle maps to a known name it is
shown as `handle (Name)`. Creator identities were not independently verified
outside Pexels' own metadata.

## Alt-text provenance

The `alt` text stored on each `mediaItem` is taken from the photo's Pexels
search-result description, lightly trimmed to fit `mediaItemSchema` (max 200
characters):

- **00000000-0000-4000-8000-000000000100** (Blueberry Buttermilk Pancakes): Stack of blueberry pancakes on a dark plate against a black studio background
- **00000000-0000-4000-8000-000000000101** (Blueberry Buttermilk Pancakes): Fluffy pancakes topped with blueberries and berry syrup, sprinkled with sugar
- **00000000-0000-4000-8000-000000000102** (Avocado, Egg & Chili Toast): Avocado toast topped with sunny-side-up eggs on a wooden board
- **00000000-0000-4000-8000-000000000103** (Lemony Chickpea Crunch Salad): Close-up of a vibrant chickpea, sweet potato and greens salad with cranberries and seeds
- **00000000-0000-4000-8000-000000000104** (Roast Chicken Pesto Ciabatta): Freshly made ciabatta sandwich with cheese, tomato and herbs on a rustic wooden table
- **00000000-0000-4000-8000-000000000105** (Sheet-Pan Lemon Herb Salmon & Vegetables): Grilled salmon fillet served with colourful roasted vegetables
- **00000000-0000-4000-8000-000000000106** (Sheet-Pan Lemon Herb Salmon & Vegetables): Fresh salmon with red peppers, mushrooms and pumpkin seeds
- **00000000-0000-4000-8000-000000000107** (Creamy Mushroom Rigatoni): Pasta in a creamy mushroom sauce garnished with herbs on a decorative plate
- **00000000-0000-4000-8000-000000000108** (Dark Chocolate Raspberry Tart): Raspberry, chocolate and nut tart on a white background
- **00000000-0000-4000-8000-000000000109** (Dark Chocolate Raspberry Tart): Chocolate tart topped with fresh raspberries and caramelised nuts
- **00000000-0000-4000-8000-00000000010a** (Honey Vanilla Panna Cotta with Berries): Panna cotta dessert with fresh berries and mint, elegantly plated

## Important caveat

> **No human has visually inspected these images.** Imagery was selected from
> Pexels *metadata* (titles/alt text/IDs researched in advance). Before trusting
> this seed on the live demo, a human must open the recipe pages and confirm
> every primary image visibly matches its recipe title. See
> `scripts/demo-seed/README.md`.
