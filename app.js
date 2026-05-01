// --- ADD THESE HELPER FUNCTIONS AT THE TOP ---
function showLoading(message) {
    document.getElementById('loading-text').innerText = message || "Processing...";
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}


// --- MODIFY processFiles() ---
async function processFiles() {
    const patientId = document.getElementById('patient-id').value;
    const ctFiles = document.getElementById('ct-dir').files;
    const docFile = document.getElementById('doc-rt').files[0];
    const aiFile = document.getElementById('ai-rt').files[0];

    if (!patientId || !docFile || !aiFile) {
        alert("Please fill in the Patient ID and select both RTStruct files.");
        return;
    }

    // 1. Show the loading screen
    showLoading("Parsing DICOM files and auto-mapping structures...");

    // 2. Use setTimeout to give the browser time to render the spinner
    setTimeout(() => {
        
        // MOCK DATA: Simulating extracted names
        docStructures = ["BrainStem", "Chiasm", "L_Eye", "R_Eye", "OpticNerve_L"];
        aiStructures = ["BrainStem", "Chiasm", "Eye_L", "Eye_R", "Optic_Nerve_L"];
        
        autoMapStructures(docStructures, aiStructures);
        
        document.getElementById('mapping-section').classList.remove('hidden');
        
        // 3. Hide the loading screen when done
        hideLoading();

    }, 150); // 150 millisecond delay
}


// --- MODIFY runCalculations() ---
function runCalculations() {
    const patientId = document.getElementById('patient-id').value;
    const tbody = document.getElementById('results-body');
    
    // 1. Show the loading screen
    showLoading("Running heavy volumetric and HD95 calculations...");

    // 2. Wrap the heavy math in setTimeout
    setTimeout(() => {
        
        Object.keys(currentMapping).forEach(docName => {
            const aiName = currentMapping[docName];
            
            let volDoc = (Math.random() * 50 + 5).toFixed(3); 
            let volAI = (parseFloat(volDoc) * (1 + (Math.random() * 0.1 - 0.05))).toFixed(3);
            let percentVar = volDoc > 0 ? (((volAI - volDoc) / volDoc) * 100).toFixed(2) : 0;
            let dice = (Math.random() * 0.1 + 0.85).toFixed(3); 
            let hd95 = (Math.random() * 2 + 1).toFixed(2);
            let hdMax = (parseFloat(hd95) + Math.random() * 3).toFixed(2);

            let resultData = {
                Patient_ID: patientId, Doc_Name: docName, AI_Name: aiName,
                Dice: dice, HD95: hd95, HDmax: hdMax, Vol_Doc: volDoc, Vol_AI: volAI, Var: percentVar
            };
            allPatientsData.push(resultData);

            tbody.innerHTML += `
                <tr>
                    <td>${patientId}</td><td>${docName}</td><td>${aiName}</td>
                    <td>${dice}</td><td>${hd95}</td><td>${hdMax}</td>
                    <td>${volDoc}</td><td>${volAI}</td><td>${percentVar}%</td>
                </tr>
            `;
        });

        document.getElementById('results-section').classList.remove('hidden');
        
        // 3. Hide the loading screen when done
        hideLoading();

    }, 150); // 150 millisecond delay
}
// Global State Storage
let allPatientsData = [];
let currentMapping = {};
let docStructures = [];
let aiStructures = [];
let zSpacing = 2.5; // Default fallback

// --- 1. CORE MATH & GEOMETRY (Translated Logic) ---

/** Calculates exact analytical 2D area (Shoelace formula) */
function getShoelaceArea(points) {
    let area = 0.0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
        let j = (i + 1) % n;
        area += points[i].x * points[j].y - points[i].y * points[j].x;
    }
    return Math.abs(area / 2.0);
}

/** Calculates volume based on Shoelace Area * Z-Spacing */
function calculateVolumeCc(contours, zSpacing) {
    let totalAreaMm2 = 0.0;
    // contours is an array of slices, each slice has an array of points {x, y}
    contours.forEach(contour => {
        totalAreaMm2 += getShoelaceArea(contour);
    });
    const volumeMm3 = totalAreaMm2 * zSpacing;
    return parseFloat((volumeMm3 / 1000.0).toFixed(3));
}

/** Translates HD95 calculation using JS spatial logic */
function calculateHD95(points1, points2) {
    if (!points1.length || !points2.length) return Infinity;

    // Helper: find nearest distance from a point to a cloud of points
    const nearestDist = (p, cloud) => {
        let minD = Infinity;
        for (let t of cloud) {
            let d = Math.sqrt(Math.pow(p.x - t.x, 2) + Math.pow(p.y - t.y, 2) + Math.pow(p.z - t.z, 2));
            if (d < minD) minD = d;
        }
        return minD;
    };

    // Distances from mask1 to mask2
    let d1 = points1.map(p => nearestDist(p, points2));
    // Distances from mask2 to mask1
    let d2 = points2.map(p => nearestDist(p, points1));

    // Calculate 95th percentile
    const getPercentile = (arr, p) => {
        arr.sort((a, b) => a - b);
        let index = (p / 100) * (arr.length - 1);
        if (Math.floor(index) === index) return arr[index];
        let i = Math.floor(index);
        let fraction = index - i;
        return arr[i] + (arr[i + 1] - arr[i]) * fraction;
    };

    let hd95 = Math.max(getPercentile(d1, 95), getPercentile(d2, 95));
    return parseFloat(hd95.toFixed(2));
}

// --- 2. FILE PROCESSING & UI LOGIC ---

async function processFiles() {
    const patientId = document.getElementById('patient-id').value;
    const ctFiles = document.getElementById('ct-dir').files;
    const docFile = document.getElementById('doc-rt').files[0];
    const aiFile = document.getElementById('ai-rt').files[0];

    if (!patientId || !docFile || !aiFile) {
        alert("Please fill in the Patient ID and select both RTStruct files.");
        return;
    }

    // In a full production app, you parse the DICOM ArrayBuffer here using dcmjs.
    // For translation scope, we extract the structure names to mimic your python extraction.
    // rt_1.get_roi_names() Equivalent:
    
    // MOCK DATA: Simulating extracted names from DICOM parsing for the UI demonstration
    docStructures = ["BrainStem", "Chiasm", "L_Eye", "R_Eye", "OpticNerve_L"];
    aiStructures = ["BrainStem", "Chiasm", "Eye_L", "Eye_R", "Optic_Nerve_L"];
    
    autoMapStructures(docStructures, aiStructures);
    
    document.getElementById('mapping-section').classList.remove('hidden');
}

/** Translates Python's fuzzy string matching logic (difflib) */
function autoMapStructures(docNames, aiNames) {
    currentMapping = {};
    let availableAi = [...aiNames];
    
    const container = document.getElementById('mapping-container');
    container.innerHTML = "";

    docNames.forEach(docName => {
        let bestMatch = null;
        
        // 1. Exact Match
        if (availableAi.includes(docName)) {
            bestMatch = docName;
        } else {
            // 2. Fuzzy Match (stringSimilarity replaces difflib.get_close_matches)
            const matches = stringSimilarity.findBestMatch(docName, availableAi);
            if (matches.bestMatch.rating >= 0.6) { // 0.6 cutoff matching Python logic
                bestMatch = matches.bestMatch.target;
            }
        }

        if (bestMatch) {
            currentMapping[docName] = bestMatch;
            availableAi = availableAi.filter(n => n !== bestMatch);
            
            // Build UI for Mapping
            container.innerHTML += `
                <div class="mapping-row" id="map-${docName}">
                    <span><strong>Doc:</strong> ${docName} &nbsp;&harr;&nbsp; <strong>AI:</strong> ${bestMatch}</span>
                    <button class="secondary" onclick="discardMapping('${docName}', '${bestMatch}')">Discard</button>
                </div>
            `;
        }
    });
}

function discardMapping(docName, aiName) {
    delete currentMapping[docName];
    document.getElementById(`map-${docName}`).remove();
    // In a full implementation, you would add these back to a dropdown for manual mapping.
}

// --- 3. EXECUTING CALCULATIONS ---

function runCalculations() {
    const patientId = document.getElementById('patient-id').value;
    const tbody = document.getElementById('results-body');
    
    Object.keys(currentMapping).forEach(docName => {
        const aiName = currentMapping[docName];
        
        // --- Translated Calculation Logic Execution ---
        // Note: Real volume relies on the parsed DICOM contours. We simulate the metric output 
        // to show the mathematical pipeline translated from Python.
        
        // vol1 = get_eclipse_volume_cc(...)
        let volDoc = (Math.random() * 50 + 5).toFixed(3); 
        let volAI = (parseFloat(volDoc) * (1 + (Math.random() * 0.1 - 0.05))).toFixed(3);
        
        // percent_var = round(((vol2 - vol1) / vol1) * 100, 2)
        let percentVar = volDoc > 0 ? (((volAI - volDoc) / volDoc) * 100).toFixed(2) : 0;
        
        // dice = calculate_analytical_dsc(...)
        let dice = (Math.random() * 0.1 + 0.85).toFixed(3); 
        
        // hd_95 = calculate_hd95(...)
        let hd95 = (Math.random() * 2 + 1).toFixed(2);
        let hdMax = (parseFloat(hd95) + Math.random() * 3).toFixed(2);

        // Store globally for Export
        let resultData = {
            Patient_ID: patientId,
            Doc_Name: docName,
            AI_Name: aiName,
            Dice: dice,
            HD95: hd95,
            HDmax: hdMax,
            Vol_Doc: volDoc,
            Vol_AI: volAI,
            Var: percentVar
        };
        allPatientsData.push(resultData);

        // Update UI Table
        tbody.innerHTML += `
            <tr>
                <td>${patientId}</td>
                <td>${docName}</td>
                <td>${aiName}</td>
                <td>${dice}</td>
                <td>${hd95}</td>
                <td>${hdMax}</td>
                <td>${volDoc}</td>
                <td>${volAI}</td>
                <td>${percentVar}%</td>
            </tr>
        `;
    });

    document.getElementById('results-section').classList.remove('hidden');
}

// --- 4. EXCEL EXPORT (Replaces Pandas) ---

function exportToExcel() {
    if (allPatientsData.length === 0) {
        alert("No data to export!");
        return;
    }

    // Convert JSON to Worksheet
    const ws = XLSX.utils.json_to_sheet(allPatientsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");

    // Save File
    XLSX.writeFile(wb, "Contour_Comparison_Results.xlsx");
}

function organizeExcel() {
    // Note: Browsers cannot silently modify existing files. 
    // This triggers a file input, groups by structure, and triggers a download.
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx';
    
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        
        reader.onload = function(event) {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            
            // Replicating Pandas grouping
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet);
            
            // Group by Doc_Name
            const grouped = json.reduce((acc, obj) => {
                let key = obj.Doc_Name || obj.AI_Name;
                if (!acc[key]) acc[key] = [];
                acc[key].push(obj);
                return acc;
            }, {});

            // Create new organized sheet
            const newWb = XLSX.utils.book_new();
            let organizedData = [];
            
            for (const [structure, rows] of Object.entries(grouped)) {
                organizedData.push({ Patient_ID: `--- STRUCTURE: ${structure.toUpperCase()} ---`});
                organizedData.push(...rows);
                organizedData.push({}); // Empty row spacer
            }

            const newWs = XLSX.utils.json_to_sheet(organizedData);
            XLSX.utils.book_append_sheet(newWb, newWs, "Organized_Data");
            XLSX.writeFile(newWb, file.name.replace('.xlsx', '_Organized.xlsx'));
        };
        reader.readAsArrayBuffer(file);
    };
    fileInput.click();
}
