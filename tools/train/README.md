# AI Training Data Generator

Trains the body-measurement AI using perfect ground truth: we set the body proportions ourselves, render the model at 4 angles, and record exact measurements (bust, waist, hips, thighs, weight, BMI) — zero measurement error.

## Setup (one time)

```bash
# Install Playwright browser
npx playwright install chromium

# Install dependencies (already in repo)
cd web && npm i
```

## Start the dev server

```bash
cd web && npm run dev        # http://localhost:5173
```

The training page is at `http://localhost:5173/train/`.

## Generate the dataset

```bash
node tools/train/generate_training_data.js
```

This will:
1. Open the training page headlessly (Chromium)
2. Sweep through all body combinations: sex × width × height × fat × muscle × abdomen
3. For each combination, render front/¾/side/back and capture PNGs
4. Record exact ground-truth measurements from the model
5. Save `training_dataset.json` (includes data URLs for all images)

**Expected output:** ~4,000+ samples (5 sexes × 4 widths × 5 heights × 5 fats × 5 muscles × 4 abdomens), ~50–100 MB JSON with embedded images.

## What the dataset contains

Each sample:
```json
{
  "id": "sample_0",
  "proportions": {
    "sex": "female", "width": 34, "height": 68, "fat": 0,
    "muscle": 0, "abdomen": "flat", "waist": 0, "bust": 0, ...},
  "measurements": {
    "bust_cm": 92.5, "waist_cm": 72.1, "hips_cm": 98.3,
    "thigh_cm": 56.2, "weight_kg": 65.4, "bmi": 23.1, ...},
  "images": {
    "front": "data:image/png;base64,...",
    "three": "...",
    "side": "...",
    "back": "..."
  }
}
```

## Train your model

Feed `training_dataset.json` into PyTorch/TensorFlow:
- **Input:** 4 images (front, ¾, side, back) + proportions (optional)
- **Output:** bust, waist, hips, thighs, weight, BMI
- **Loss:** MAE against `measurements.*` (perfect ground truth)

Because every sample's answer is known exactly, the model can converge to unmatched precision — no ambiguous human measurements to corrupt the signal.

## Tips

- **Reduce the sweep** for faster runs: edit `WIDTHS_CM`, `HEIGHTS_IN`, `FATS`, `MUSCLES`, `ABDOMENS` in the script.
- **Headless mode** is set; change `headless: true` to `false` to watch it run.
- The script pauses 300–1200ms between actions so the 3D renderer has time to draw each frame.
