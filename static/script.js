document.querySelectorAll(".section h3").forEach(header => {
    header.addEventListener("click", () => {
        const content = header.nextElementSibling;
        content.style.display = content.style.display === "block" ? "none" : "block";
    });
});

const uploadBtn = document.getElementById("upload-btn");
const colorPicker = document.getElementById("color-picker");
const undoBtn = document.getElementById("undo-btn");
const downloadBtn = document.getElementById("download-btn");
const originalImage = document.getElementById("original-image");
const maskCanvas = document.getElementById("mask-canvas");
const hoverCanvas = document.getElementById("hover-canvas");
const ctx = maskCanvas.getContext("2d");
const hoverCtx = hoverCanvas.getContext("2d");
let maskTextureScales = {}; // Track scale per mask

var selectedTile = null;
let selectedMaskIndex = null;

let masks = [];
let maskColors = {}; 
let maskTextures = {}; 
let changeHistory = []; 


const scaleSlider = document.getElementById("texture-scale");
const scaleValueDisplay = document.getElementById("scale-value");
let textureScale = 1.0; // Default scale

// Update scale when slider changes
scaleSlider.addEventListener("input", () => {
    textureScale = parseFloat(scaleSlider.value);
    scaleValueDisplay.textContent = `${textureScale.toFixed(1)}x`;
    applyTextureOrColor();  
    updateSelectedMasks(); // Apply the new scale instantly
});

uploadBtn.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append("image", file);

    const reader = new FileReader();
    reader.onload = (e) => {
        originalImage.src = e.target.result;
        originalImage.style.display = "block";
    };
    reader.readAsDataURL(file);

    const response = await fetch("http://127.0.0.1:5000/upload", {
        method: "POST",
        body: formData
    });
   
    const data = await response.json();
    if (data.error) {
        alert(data.error);
        return;
    }
    console.log(data);

    masks = data.segments.map(base64 => {
        const img = new Image();
        img.src = "data:image/png;base64," + base64;
        return img;
    });

    Promise.all(masks.map(img => new Promise(resolve => img.onload = resolve)))
        .then(() => {
            maskCanvas.width = hoverCanvas.width = originalImage.width;
            maskCanvas.height = hoverCanvas.height = originalImage.height;
            ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
            hoverCtx.clearRect(0, 0, hoverCanvas.width, hoverCanvas.height);
            maskColors = {};
            maskTextures = {};
            maskTextureScales = {};
            changeHistory = [];
            undoBtn.disabled = true;
        });
});

hoverCanvas.addEventListener("click", (e) => {
    const rect = hoverCanvas.getBoundingClientRect();
    const scaleX = originalImage.naturalWidth / hoverCanvas.width;
    const scaleY = originalImage.naturalHeight / hoverCanvas.height;
    
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    for (let i = 0; i < masks.length; i++) {
        const maskCtx = document.createElement("canvas").getContext("2d");
        maskCtx.canvas.width = originalImage.naturalWidth;
        maskCtx.canvas.height = originalImage.naturalHeight;
        maskCtx.drawImage(masks[i], 0, 0, maskCtx.canvas.width, maskCtx.canvas.height);

        const maskData = maskCtx.getImageData(x, y, 1, 1).data;
        if (maskData[3] > 0) {
            selectedMaskIndex = i;
            applyTextureOrColor();
            return;
        }
    }
});

function applyTextureOrColor() {
    if (selectedMaskIndex === null) return;

    changeHistory.push({
        index: selectedMaskIndex,
        color: maskColors[selectedMaskIndex] || null,
        texture: maskTextures[selectedMaskIndex] || null
    });

    if (selectedTile) {
        maskTextures[selectedMaskIndex] = selectedTile.style.backgroundImage.slice(5, -2);
        maskTextureScales[selectedMaskIndex] = textureScale;
        delete maskColors[selectedMaskIndex];
    } else {
        maskColors[selectedMaskIndex] = colorPicker.value;
        delete maskTextures[selectedMaskIndex];
        delete maskTextureScales[selectedMaskIndex];
    }

    undoBtn.disabled = false;
    updateSelectedMasks();
}

function updateSelectedMasks() {
    hoverCtx.clearRect(0, 0, hoverCanvas.width, hoverCanvas.height);

    // Get all selected mask indices (from both colors & textures)
    const selectedIndices = new Set([
        ...Object.keys(maskColors).map(Number),
        ...Object.keys(maskTextures).map(Number)
    ]);

    selectedIndices.forEach(index => {
        const maskIndex = parseInt(index);
        const selectedMask = masks[maskIndex];
        if (!selectedMask) return;

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = hoverCanvas.width;
        tempCanvas.height = hoverCanvas.height;
        const tempCtx = tempCanvas.getContext("2d");

        let textureUrl = maskTextures[maskIndex]; // Get texture if assigned

        if (textureUrl) {
            const img = new Image();
            img.crossOrigin = "anonymous"; // Ensure cross-origin textures load correctly
            img.src = textureUrl;
            let scale = maskTextureScales[maskIndex] || 1;
            img.onload = function () {
                
                const pattern = tempCtx.createPattern(img, 'repeat'); // Repeat the texture
                tempCtx.fillStyle = pattern;

                 // Scale the texture by reducing the size
                tempCtx.save();
                tempCtx.scale(scale, scale); // Apply user-selected scale
                tempCtx.fillRect(0, 0, tempCanvas.width / scale, tempCanvas.height / scale);
                tempCtx.restore();
                
                // tempCtx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);
                applyMask(tempCtx, selectedMask);
                hoverCtx.drawImage(tempCanvas, 0, 0);
            };
        } else {
            tempCtx.fillStyle = maskColors[maskIndex] || "#FFFFFF"; // Default to white if no color
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            applyMask(tempCtx, selectedMask);
            hoverCtx.drawImage(tempCanvas, 0, 0);
        }
    });
}


function applyMask(ctx, mask) {
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalCompositeOperation = "source-over";
}

undoBtn.addEventListener("click", () => {
    if (changeHistory.length > 0) {
        const lastChange = changeHistory.pop();

        if (lastChange) {
            if (lastChange.color !== null) {
                maskColors[lastChange.index] = lastChange.color;
            } else {
                delete maskColors[lastChange.index];
            }

            if (lastChange.texture !== null) {
                maskTextures[lastChange.index] = lastChange.texture;
            } else {
                delete maskTextures[lastChange.index];
            }
        }

        updateSelectedMasks();

        if (changeHistory.length === 0) {
            undoBtn.disabled = true;
        }
    }
});

downloadBtn.addEventListener("click", () => {
    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = maskCanvas.width;
    finalCanvas.height = maskCanvas.height;
    const finalCtx = finalCanvas.getContext("2d");

    finalCtx.drawImage(originalImage, 0, 0, finalCanvas.width, finalCanvas.height);
    finalCtx.drawImage(hoverCanvas, 0, 0);
    
    const link = document.createElement("a");
    link.href = finalCanvas.toDataURL("image/png");
    link.download = "segmented_image.png";
    link.click();
});

async function loadTextures() {
    const response = await fetch('/get-textures'); 
    const textures = await response.json();
    const container = document.getElementById('texture-container');

    textures.forEach(texture => {
        const tile = document.createElement('div');
        tile.classList.add('texture-tile');
        tile.style.background = `url('/static/texture/${texture}')`;
        tile.style.backgroundSize = 'cover';

        tile.addEventListener("click", function() {
            var check = this.classList.contains("selected");
            selectedTile = null;
            document.querySelectorAll(".texture-tile").forEach(t => t.classList.remove("selected"));
            if (!check) {
                this.classList.add("selected");    
                selectedTile = this;
            }
        });

        const name = document.createElement('span');
        name.classList.add('texture-name');
        name.textContent = texture.split('.')[0].replace('_', '');
        tile.appendChild(name);
        container.appendChild(tile);
    });
}
document.addEventListener('DOMContentLoaded', loadTextures);


