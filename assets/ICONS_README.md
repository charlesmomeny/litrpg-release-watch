# Icon Generation

For development/testing, you can create simple placeholder icons:

1. Create a simple 128x128 PNG with your logo
2. Resize it to create the other sizes:
   - 16x16 (icon16.png)
   - 32x32 (icon32.png)
   - 48x48 (icon48.png)
   - 128x128 (icon128.png)

You can use online tools like:
- https://www.canva.com (design custom icons)
- https://www.photopea.com (resize images)
- Or use ImageMagick: `convert icon128.png -resize 16x16 icon16.png`

## Temporary Placeholder Icons

For quick testing, create simple colored squares:

```bash
# If you have ImageMagick installed:
convert -size 128x128 xc:#d97706 -fill white -pointsize 60 -gravity center -annotate +0+0 '📚' icon128.png
convert icon128.png -resize 48x48 icon48.png
convert icon128.png -resize 32x32 icon32.png
convert icon128.png -resize 16x16 icon16.png
```

Or use any image editor to create simple square icons with a book emoji or the letters "LRW".
