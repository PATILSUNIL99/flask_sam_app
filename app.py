from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import os
import base64
from io import BytesIO
import json
from datetime import datetime
import numpy as np
import cv2
from PIL import Image
import torch
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator, SamPredictor
# from mobile_sam import sam_model_registry, SamAutomaticMaskGenerator, SamPredictor

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

MODEL_PATH = "models/sam_vit_h_4b8939.pth"
# MODEL_PATH = "models/mobile_sam.pt"
model_type = "vit_h"
# model_type = "vit_t"
device = "cuda" if torch.cuda.is_available() else "cpu"
sam = sam_model_registry[model_type](checkpoint=MODEL_PATH).to(device)
mask_generator = SamAutomaticMaskGenerator(sam)

def filter_wall_ceiling_masks(masks, image_shape):
    """ Filter out only wall and ceiling masks based on heuristic rules. """
    image_height, image_width = image_shape[:2]
    
    filtered_masks = []

    for mask in masks:
        segmentation = mask["segmentation"]
        area = np.sum(segmentation)  # Count non-zero pixels (mask size)
        x_coords, y_coords = np.where(segmentation)  # Get mask position

        # # Heuristic: Large masks covering significant area
        # if area < (image_height * image_width * 0.1):  # Ignore very small segments
        #     continue

        # Heuristic: Walls are mostly vertical
        if np.max(x_coords) - np.min(x_coords) > np.max(y_coords) - np.min(y_coords):
            filtered_masks.append(mask)
            continue

        # Heuristic: Ceilings are at the top
        if np.min(y_coords) < image_height * 0.2:  # Check if top 30% of the image
            filtered_masks.append(mask)
        # filtered_masks.append(mask)

    return filtered_masks

def apply_color_to_mask(mask, color=(255, 0, 0, 128)):
    """Applies a color to the mask while preserving transparency.
    
    Args:
        mask (np.array): Binary mask of the segment.
        color (tuple): RGBA color (default: semi-transparent red).
        
    Returns:
        np.array: Colored mask with transparency.
    """
    h, w = mask.shape
    colored_mask = np.zeros((h, w, 4), dtype=np.uint8)
    
    # Apply color where mask is present
    colored_mask[mask > 0] = color  

    return colored_mask


def encode_image_to_base64(image):
    _, buffer = cv2.imencode('.png', image)
    return base64.b64encode(buffer).decode('utf-8')


def make_masks_mutually_exclusive(masks):
    """Ensure masks are mutually exclusive while keeping small segments intact."""
    if not masks:
        return []

    # Sort masks by area (smallest first)
    masks = sorted(masks, key=lambda m: np.sum(m > 0))

    # Track occupied areas
    final_mask = np.zeros_like(masks[0], dtype=np.uint8)
    exclusive_masks = []

    for mask in masks:
        # Retain only the non-overlapping region of the mask
        exclusive_mask = cv2.bitwise_and(mask, cv2.bitwise_not(final_mask))
        # If the mask became empty, keep the original
        if np.sum(exclusive_mask) == 0:
            exclusive_mask = mask.copy()
        # Add to results
        exclusive_masks.append(exclusive_mask)
        # Update occupied area
        final_mask = cv2.bitwise_or(final_mask, exclusive_mask)

    return exclusive_masks


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/index1")
def index1():
    return render_template("index1.html")


@app.route('/get-textures')
def get_textures():
    texture_folder = os.path.join(app.static_folder, 'texture')
    texture_files = [f for f in os.listdir(texture_folder) if f.endswith(('.jpg', '.png', '.jpeg'))]
    return jsonify(texture_files)


@app.route("/test", methods=["POST"])
def test():
    print("Call : " , datetime.now())
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    # Load the JSON data
    input_file= "static/data.json"
    with open(input_file, encoding="utf-8") as json_file:
        data = json.load(json_file)
    return jsonify(data), 200


@app.route("/upload", methods=["POST"])
def upload():
    print("Call : " , datetime.now())
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400
   
    file = request.files['image']
    image = np.frombuffer(file.read(), np.uint8)
    image = cv2.imdecode(image, cv2.IMREAD_COLOR)
    # Generate masks using MobileSAM
    masks_data = mask_generator.generate(image)
    
    # Extract masks as uint8 without converting to binary (0-1 format retained)
    masks = [mask["segmentation"].astype(np.uint8) for mask in masks_data]

     # Make masks mutually exclusive
    exclusive_masks = make_masks_mutually_exclusive(masks)

    # Apply color to each mask while preserving transparency
    colored_masks = [apply_color_to_mask(mask) for mask in exclusive_masks]

    # Encode the masks into Base64 format
    encoded_masks = [encode_image_to_base64(mask) for mask in colored_masks]

    print("End : " , datetime.now())
    return jsonify({"segments": encoded_masks, "image_size": image.size})

if __name__ == "__main__":
    
    app.run(debug=True)