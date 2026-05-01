// ==========================================
// --- GLOBAL DATA STORAGE ---
// ==========================================
let allPatientsData = [];
let currentMapping = {};
let unmappedDoc = [];
let unmappedAi = [];

// ==========================================
// --- HELPER FUNCTIONS ---
// ==========================================
function showLoading(message) {
    document.getElementById('loading-text').innerText = message || "Processing...";
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

// Replicates Python's difflib.SequenceMatcher for Smart Mapping
function difflibRatio(s1, s2) {
    if (!s1 || !s2) return 0;
    const longer = s1.length > s2.length ? s1.toLowerCase() : s2.toLowerCase();
    const shorter = s1.length > s2.length ? s2.toLowerCase() : s1.toLowerCase();
    
    if (longer.length === 0) return 1.0;
    
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
        if (longer.includes(shorter[i])) {
            matches++;
        }
    }
    return (2.0 * matches) / (s1.length + s2.length);
}

// =========================================================
// --- EXACT MATHEMATICS & GEOMETRY (PYTHON REPLICA) ---
// =========================================================

// 1. Calculate Exact GeoJSON Area (Shoelace Formula equivalent for polygons)
function calculateGeoJsonArea(geom) {
    let area = 0.0;
    if (!geom || geom.length === 0) return 0;
    geom.forEach(polygon => {
        polygon.forEach((ring, index) => {
            let ringArea = 0.0;
            let j = ring.length - 1;
            for (let i = 0; i < ring.length; i++) {
                ringArea += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
                j = i;
            }
            ringArea = Math.abs(ringArea / 2.0);
            if (index === 0) area += ringArea; // Add exterior ring
            else area -= ringArea; // Subtract interior rings (holes)
        });
    });
    return area;
}

// 2. Replicates Shapely Polygon Extraction & Unary Union
function extractPolygonsBySlice(contourSequence) {
    let slicePolygons = {};
    let zValues = new Set();
    let totalShoelaceAreaMm2 = 0.0;
    let pointCloud = [];

    contourSequence.forEach(contour => {
        if (!contour.ContourData) return;
        let data = contour.ContourData;
        let pts = [];
        
        let zVal = Math.round(data[2] * 100) / 100; 
        zValues.add(zVal);

        for (let i = 0; i < data.length; i += 3) {
            pts.push([data[i], data[i+1]]); // Extract X, Y
            pointCloud.push({ x: data[i], y: data[i+1], z: data[i+2] });
        }

        if (pts.length > 2 && (pts[0][0] !== pts[pts.length-1][0] || pts[0][1] !== pts[pts.length-1][1])) {
            pts.push([pts[0][0], pts[0][1]]);
        }

        if (!slicePolygons[zVal]) slicePolygons[zVal] = [];
        slicePolygons[zVal].push([pts]);

        let contourGeom = [[pts]]; 
        totalShoelaceAreaMm2 += calculateGeoJsonArea(contourGeom);
    });

    let unionedPolygons = {};
    for (let z in slicePolygons) {
        try {
            unionedPolygons[z] = polygonClipping.union(...slicePolygons[z]);
        } catch (e) {
            unionedPolygons[z] = slicePolygons[z]; 
        }
    }

    let sortedZ = Array.from(zValues).sort((a,b)=>a-b);
    let zSpacing = 2.5; 
    if (sortedZ.length > 1) {
        let diffs = [];
        for (let i = 1; i < sortedZ.length; i++) {
            diffs.push(Math.abs(sortedZ[i] - sortedZ[i-1]));
        }
        zSpacing = Math.min(...diffs.filter(d => d > 0.1)); 
    }

    return { 
        polygons: unionedPolygons, 
        area: totalShoelaceAreaMm2,
        zSpacing: zSpacing,
        points: pointCloud
    };
}

// 3. Extract Geometry Data from DICOM file
async function extractStructureData(file, targetRoiName) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const arrayBuffer = event.target.result;
                const dicomDict = dcmjs.data.DicomMessage.readFile(arrayBuffer);
                const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
                
                let roiNum = null;
                const roiSeq = Array.isArray(dataset.StructureSetROISequence) ? dataset.StructureSetROISequence : [dataset.StructureSetROISequence];
                
                for (let roi of roiSeq) {
                    if (roi.ROIName && roi.ROIName.trim() === targetRoiName) {
                        roiNum = roi.ROINumber; break;
                    }
                }

                if (roiNum === null) return resolve(null);

                const contourSeq = Array.isArray(dataset.ROIContourSequence) ? dataset.ROIContourSequence : [dataset.ROIContourSequence];
                
                for (let roiContour of contourSeq) {
                    if (roiContour.ReferencedROINumber === roiNum && roiContour.ContourSequence) {
                        let sequences = Array.isArray(roiContour.ContourSequence) ? roiContour.ContourSequence : [roiContour.ContourSequence];
                        let data = extractPolygonsBySlice(sequences);
                        return resolve(data);
                    }
                }
                resolve(null);
            } catch (e) {
                console.error(e); resolve(null);
            }
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(file);
    });
}

// 4. Replicates Exact Shapely Continuous DSC
function calculateExactDSC(docData, aiData, zSpacing, volDoc, volAi) {
    if (volDoc === 0 && volAi === 0) return 1.0;
    if (volDoc === 0 || volAi === 0) return 0.0;

    let totalIntersectionAreaMm2 = 0.0;
    let docZ = Object.keys(docData.polygons);
    let commonZ = docZ.filter(z => aiData.polygons[z]);

    commonZ.forEach(z => {
        let p1 = docData.polygons[z];
        let p2 = aiData.polygons[z];
        try {
            let intersection = polygonClipping.intersection(p1, p2);
            totalIntersectionAreaMm2 += calculateGeoJsonArea(intersection);
        } catch (e) {
            console.warn(`Topology intersection failed on slice Z: ${z}`);
        }
    });

    let intersectionVolCc = (totalIntersectionAreaMm2 * zSpacing) / 1000.0;
    return (2.0 * intersectionVolCc) / (volDoc + volAi);
}

// 5. Replicates scipy cKDTree Exact Surface Distances
function calculateHD95(points1, points2) {
    if (!points1 || !points2 || points1.length === 0 || points2.length === 0) {
        return { hd95: Infinity, hdMax: Infinity };
    }

    function getDirectedDistances(source, target) {
        let dists = new Float32Array(source.length);
        for (let i = 0; i < source.length; i++) {
            let p1 = source[i];
            let minDistSq = Infinity;
            for (let j = 0; j < target.length; j++) {
                let p2 = target[j];
                let dx = p1.x - p2.x; let dy = p1.y - p2.y; let dz = p1.z - p2.z;
                let dSq = dx*dx + dy*dy + dz*dz;
                if (dSq < minDistSq) minDistSq = dSq;
            }
            dists[i] = Math.sqrt(minDistSq);
        }
        return dists;
    }

    let d1 = getDirectedDistances(points1, points2);
    let d2 = getDirectedDistances(points2, points1);

    let combined = new Float32Array(d1.length + d2.length);
    combined.set(d1); combined.set(d2, d1.length);
    combined.sort();

    let idx95 = Math.floor(combined.length * 0.95);
    return { hd95: combined[idx95], hdMax: combined[combined.length - 1] };
}


// ==========================================
// --- PHASE 1: LOAD & AUTO-MAP ---
// ==========================================
async function getStructuresFromDICOM(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const arrayBuffer = event.target.result;
                const dicomDict = dcmjs.data.DicomMessage.readFile(arrayBuffer);
                const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomDict.dict);
                
                let roiNames = [];
                if (dataset.StructureSetROISequence) {
                    const seq = Array.isArray(dataset.StructureSetROISequence) ? dataset.StructureSetROISequence : [dataset.StructureSetROISequence];
                    seq.forEach(item => { if (item.ROIName) roiNames.push(item.ROIName.trim()); });
                }
                resolve(roiNames);
            } catch (e) {
                console.error("DICOM Parsing Error:", e);
                reject(`Could not read structures from ${file.name}. Ensure it is a valid RTStruct.`);
            }
        };
        reader.onerror = () => reject("File reading error");
        reader.readAsArrayBuffer(file);
    });
}

function processFiles() {
    console.log("processFiles function triggered.");
    const patientId = document.getElementById('patient-id').value;
    const docFile = document.getElementById('doc-rt').files[0];
    const aiFile = document.getElementById('ai-rt').files[0];

    if (!patientId || !docFile || !aiFile) {
        alert("Please fill in the Patient ID and select both RTStruct files."); 
        return;
    }

    // 1. Show the loading screen FIRST
    showLoading(`Reading DICOM files for ${patientId}. Please wait...`);

    // 2. Wrap the heavy async file reading in setTimeout so the browser renders the spinner
    setTimeout(async () => {
        try {
            const docNames = await getStructuresFromDICOM(docFile);
            const aiNames = await getStructuresFromDICOM(aiFile);
            
            if (docNames.length === 0 || aiNames.length === 0) {
                alert("Error: No structures found in one or both of the DICOM files."); 
                hideLoading(); 
                return;
            }

            currentMapping = {}; unmappedDoc = [];
            let availableAiNames = [...aiNames]; 

            docNames.forEach(docName => {
                if (availableAiNames.includes(docName)) {
                    currentMapping[docName] = docName;
                    availableAiNames = availableAiNames.filter(n => n !== docName);
                } else {
                    let bestMatch = null; let highestScore = 0;
                    availableAiNames.forEach(aiName => {
                        let score = difflibRatio(docName, aiName);
                        if (score > highestScore) { highestScore = score; bestMatch = aiName; }
                    });

                    if (bestMatch && highestScore >= 0.6) {
                        currentMapping[docName] = bestMatch;
                        availableAiNames = availableAiNames.filter(n => n !== bestMatch);
                    } else {
                        unmappedDoc.push(docName);
                    }
                }
            });

            unmappedAi = availableAiNames;
            renderMappingUI();
            document.getElementById('mapping-section').classList.remove('hidden');
            
        } catch (error) { 
            console.error(error);
            alert(error); 
        } finally { 
            hideLoading(); 
        }
    }, 150);
}

// ==========================================
// --- PHASE 2: MANUAL MAPPING & ID NAMING ---
// ==========================================
function renderMappingUI() {
    const container = document.getElementById('mapping-container');
    const docSelect = document.getElementById('unmapped-doc');
    const aiSelect = document.getElementById('unmapped-ai');
    const manualSection = document.getElementById('manual-mapping-section');

    container.innerHTML = "";
    
    Object.keys(currentMapping).sort().forEach(docName => {
        let aiName = currentMapping[docName];
        let matchType = (docName === aiName) ? "Exact" : "Fuzzy";
        
        container.innerHTML += `
            <div class="mapping-row" id="map-${docName}">
                <div style="display:flex; flex-direction:column; gap:8px; flex-grow:1;">
                    <span><strong>Doc:</strong> ${docName} &nbsp;&harr;&nbsp; <strong>AI:</strong> ${aiName} <em>(${matchType})</em></span>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <label style="font-size:13px; font-weight:bold; color:var(--primary); margin:0;">ID Name:</label>
                        <input type="text" id="id-name-${docName}" value="${aiName}" style="padding:5px; border:1px solid #ccc; border-radius:4px; width:250px;">
                    </div>
                </div>
                <button class="secondary btn-sm" onclick="discardMapping('${docName}', '${aiName}')">Discard</button>
            </div>
        `;
    });

    if (Object.keys(currentMapping).length === 0) container.innerHTML = "<p><em>--- NO AUTO-MATCHES FOUND ---</em></p>";

    docSelect.innerHTML = `<option value="">-- Select Unmapped DOCTOR Structure --</option>` + unmappedDoc.sort().map(d => `<option value="${d}">${d}</option>`).join('');
    aiSelect.innerHTML = `<option value="">-- Select Unmapped AI Structure --</option>` + unmappedAi.sort().map(a => `<option value="${a}">${a}</option>`).join('');

    if (unmappedDoc.length > 0 && unmappedAi.length > 0) manualSection.style.display = "block";
    else manualSection.style.display = "none";
}

function discardMapping(docName, aiName) {
    delete currentMapping[docName]; unmappedDoc.push(docName); unmappedAi.push(aiName); renderMappingUI();
}

function addManualMapping() {
    const docName = document.getElementById('unmapped-doc').value;
    const aiName = document.getElementById('unmapped-ai').value;
    if (!docName || !aiName) { alert("Please select both a DOCTOR and an AI structure to pair them."); return; }
    currentMapping[docName] = aiName;
    unmappedDoc = unmappedDoc.filter(n => n !== docName); unmappedAi = unmappedAi.filter(n => n !== aiName);
    renderMappingUI();
}

// ==========================================
// --- PHASE 3: CALCULATE & LOOP ---
// ==========================================
function runCalculations() {
    const patientId = document.getElementById('patient-id').value;
    const docFile = document.getElementById('doc-rt').files[0];
    const aiFile = document.getElementById('ai-rt').files[0];
    const tbody = document.getElementById('results-body');
    
    if (Object.keys(currentMapping).length === 0) {
        alert("No mappings provided. Please map structures first."); return;
    }

    showLoading(`Running exact geometric math for ${patientId}. This will take a moment for large structures...`);

    setTimeout(async () => {
        try {
            for (let docName of Object.keys(currentMapping).sort()) {
                const aiName = currentMapping[docName];
                const idNameInput = document.getElementById(`id-name-${docName}`);
                const idName = idNameInput ? idNameInput.value.trim() : aiName;
                
                let docData = await extractStructureData(docFile, docName);
                let aiData = await extractStructureData(aiFile, aiName);

                let zSpacing = 2.5; 
                if (docData && docData.zSpacing > 0) zSpacing = docData.zSpacing;
                else if (aiData && aiData.zSpacing > 0) zSpacing = aiData.zSpacing;

                let volDoc = docData ? (docData.area * zSpacing) / 1000.0 : 0;
                let volAi = aiData ? (aiData.area * zSpacing) / 1000.0 : 0;
                
                let percentVar = volDoc > 0 ? (((volAi - volDoc) / volDoc) * 100) : 0;
                let dice = 0.0, hd95 = Infinity, hdMax = Infinity;

                if (docData && aiData) {
                    dice = calculateExactDSC(docData, aiData, zSpacing, volDoc, volAi);
                    let hdMetrics = calculateHD95(docData.points, aiData.points);
                    hd95 = hdMetrics.hd95;
                    hdMax = hdMetrics.hdMax;
                }

                let safeVolDoc = volDoc.toFixed(3);
                let safeVolAI = volAi.toFixed(3);
                let safeVar = isFinite(percentVar) ? percentVar.toFixed(2) + '%' : "Inf";
                let safeDice = isFinite(dice) ? dice.toFixed(3) : "0.000";
                let safeHD95 = isFinite(hd95) ? hd95.toFixed(2) : "inf";
                let safeHDMax = isFinite(hdMax) ? hdMax.toFixed(2) : "inf";

                let resultData = {
                    Patient_ID: patientId, Identification_Name: idName, 
                    Doc_Name: docName, AI_Name: aiName, Dice: safeDice, 
                    HD95: safeHD95, HDmax: safeHDMax, Vol_Doc: safeVolDoc, Vol_AI: safeVolAI, Var: parseFloat(percentVar).toFixed(2)
                };
                allPatientsData.push(resultData);

                tbody.innerHTML += `
                    <tr>
                        <td>${patientId}</td>
                        <td style="font-weight:bold; color:var(--primary);">${idName}</td>
                        <td>${docName}</td><td>${aiName}</td>
                        <td>${safeDice}</td><td>${safeHD95}</td><td>${safeHDMax}</td>
                        <td>${safeVolDoc}</td><td>${safeVolAI}</td><td>${safeVar}</td>
                    </tr>
                `;
            }

            document.getElementById('results-section').classList.remove('hidden');
            
            // Loop reset
            document.getElementById('patient-id').value = "";
            document.getElementById('doc-rt').value = "";
            document.getElementById('ai-rt').value = "";
            document.getElementById('mapping-section').classList.add('hidden');
            
            hideLoading();
            alert(`Calculations complete! Enter the next patient ID at the top.`);

        } catch (error) {
            console.error(error); hideLoading();
            alert("Calculation failed due to an exact geometry parsing error.");
        } 
    }, 150);
}

// ==========================================
// --- EXPORT logic ---
// ==========================================
function exportToExcel() {
    if (allPatientsData.length === 0) { alert("No data to export!"); return; }
    const ws = XLSX.utils.json_to_sheet(allPatientsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    XLSX.writeFile(wb, "Contour_Comparison_Results.xlsx");
}

function organizeExcel() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = '.xlsx';
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = function(event) {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet);
            
            const grouped = json.reduce((acc, obj) => {
                let key = obj.Identification_Name || obj.Doc_Name || obj.AI_Name;
                if (!acc[key]) acc[key] = [];
                acc[key].push(obj);
                return acc;
            }, {});

            const newWb = XLSX.utils.book_new();
            let organizedData = [];
            
            for (const [structure, rows] of Object.entries(grouped)) {
                organizedData.push({ Patient_ID: `--- STRUCTURE: ${structure.toUpperCase()} ---`});
                organizedData.push(...rows); organizedData.push({});
            }

            const newWs = XLSX.utils.json_to_sheet(organizedData);
            XLSX.utils.book_append_sheet(newWb, newWs, "Organized_Data");
            XLSX.writeFile(newWb, file.name.replace('.xlsx', '_Organized.xlsx'));
        };
        reader.readAsArrayBuffer(file);
    };
    fileInput.click();
}
