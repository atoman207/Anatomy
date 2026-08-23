# Landing page photography

All four photographs are of locations in Japan and are published under the
[Unsplash License](https://unsplash.com/license) — free for commercial use,
no permission or attribution required. They are vendored here rather than
hot-linked from `images.unsplash.com`, so the landing page does not break if
the CDN changes or the photo is taken down.

The credit line in the site footer is a courtesy, not a licence obligation.

| File | Subject / location | Photographer | Source |
| --- | --- | --- | --- |
| `fuji.jpg` | 富士山（静岡県富士宮市） | Marina Konno (@komaro) | https://unsplash.com/photos/mount-fuji-japan-ZAJHPzWMGec |
| `sakura-kyoto.jpg` | 大沢池の桜（京都市右京区） | Ryuta (@srtgraphy) | https://unsplash.com/photos/cherry-blossoms-frame-a-tranquil-lake-on-a-clear-day-2R29wKpIWJ8 |
| `torii-kyoto.jpg` | 伏見稲荷大社 千本鳥居（京都市伏見区） | Sarmat Batagov | https://unsplash.com/photos/rows-of-vibrant-orange-torii-gates-in-a-temple-VulPpt46fXk |
| `tokyo-night.jpg` | 東京タワー（東京都港区） | T Y (@tyr123) | https://unsplash.com/photos/tokyo-tower-illuminated-at-night-with-city-skyline-t1JoTScJs-c |

To replace one, download at a similar width and keep the filename:

```
curl -L -o public/landing/<name>.jpg \
  "https://images.unsplash.com/photo-<id>?fm=jpg&q=72&w=1200&auto=format&fit=crop"
```
