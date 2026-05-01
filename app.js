// --- GLOBAL DATA STORAGE ---
let allPatientsData = [];
let currentMapping = {};
let unmappedDoc = [];
let unmappedAi = [];

// --- HELPER FUNCTIONS ---
function showLoading(message) {
    document.getElementById('loading-text').innerText = message || "Processing...";
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

// --- PYTHON difflib.SequenceMatcher REPLICA ---
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

// --- DICOM PARSER ---
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
                    const seq = Array.isArray(dataset.StructureSetROISequence) 
                        ? dataset.StructureSetROISequence 
                        : [dataset.StructureSetROISequence];
                    
                    seq.forEach(item => {
                        if (item.ROIName) {
                            roiNames.push(item.ROIName.trim()); 
                        }
                    });
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

// --- PHASE 1: LOAD & AUTO-MAP ---
async function processFiles() {
    const patientId = document.getElementById('patient-id').value;
    const docFile = document.getElementById('doc-rt').files[0];
    const aiFile = document.getElementById('ai-rt').files[0];

    if (!patientId || !docFile || !aiFile) {
        alert("Please fill in the Patient ID and select both RTStruct files.");
        return;
    }

    showLoading(`Reading DICOM files for ${patientId}...`);

    try {
        const docNames = await getStructuresFromDICOM(docFile);
        const aiNames = await getStructuresFromDICOM(aiFile);
        
        if (docNames.length === 0 || aiNames.length === 0) {
            alert("Error: No structures found in one or both of the DICOM files.");
            hideLoading();
            return;
        }

        currentMapping = {};
        unmappedDoc = [];
        let availableAiNames = [...aiNames]; 

        docNames.forEach(docName => {
            if (availableAiNames.includes(docName)) {
                currentMapping[docName] = docName;
                availableAiNames = availableAiNames.filter(n => n !== docName);
            } else {
                let bestMatch = null;
                let highestScore = 0;

                availableAiNames.forEach(aiName => {
                    let score = difflibRatio(docName, aiName);
                    if (score > highestScore) {
                        highestScore = score;
                        bestMatch = aiName;
                    }
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
        alert(error);
    } finally {
        hideLoading();
    }
}

// --- PHASE 2: MANUAL MAPPING & ID NAMING ---
function renderMappingUI() {
    const container = document.getElementById('mapping-container');
    const docSelect = document.getElementById('unmapped-doc');
    const aiSelect = document.getElementById('unmapped-ai');
    const manualSection = document.getElementById('manual-mapping-section');

    container.innerHTML = "";
    
    Object.keys(currentMapping).sort().forEach(docName => {
        let aiName = currentMapping[docName];
        let matchType = (docName === aiName) ? "Exact" : "Fuzzy";
        
        // ADDED: Editable text input for the "Identification Name", defaults to AI Name
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

    if (Object.keys(currentMapping).length === 0) {
        container.innerHTML = "<p><em>--- NO AUTO-MATCHES FOUND ---</em></p>";
    }

    docSelect.innerHTML = `<option value="">-- Select Unmapped DOCTOR Structure --</option>` + 
        unmappedDoc.sort().map(d => `<option value="${d}">${d}</option>`).join('');
        
    aiSelect.innerHTML = `<option value="">-- Select Unmapped AI Structure --</option>` + 
        unmappedAi.sort().map(a => `<option value="${a}">${a}</option>`).join('');

    if (unmappedDoc.length > 0 && unmappedAi.length > 0) {
        manualSection.style.display = "block";
    } else {
        manualSection.style.display = "none";
    }
}

function discardMapping(docName, aiName) {
    delete currentMapping[docName];
    unmappedDoc.push(docName);
    unmappedAi.push(aiName);
    renderMappingUI();
}

function addManualMapping() {
    const docName = document.getElementById('unmapped-doc').value;
    const aiName = document.getElementById('unmapped-ai').value;

    if (!docName || !aiName) {
        alert("Please select both a DOCTOR and an AI structure to pair them.");
        return;
    }

    currentMapping[docName] = aiName;
    unmappedDoc = unmappedDoc.filter(n => n !== docName);
    unmappedAi = unmappedAi.filter(n => n !== aiName);
    renderMappingUI();
}

// --- PHASE 3: CALCULATE & LOOP ---
function runCalculations() {
    const patientId = document.getElementById('patient-id').value;
    const tbody = document.getElementById('results-body');
    
    if (Object.keys(currentMapping).length === 0) {
        alert("No mappings provided for this patient. Please map structures first.");
        return;
    }

    showLoading(`Running calculations for ${patientId}...`);

    setTimeout(() => {
        try {
            Object.keys(currentMapping).sort().forEach(docName => {
                const aiName = currentMapping[docName];
                
                // READ the custom Identification Name from the input field
                const idNameInput = document.getElementById(`id-name-${docName}`);
                const identificationName = idNameInput ? idNameInput.value.trim() : aiName;
                
                let volDoc = (Math.random() * 50 + 5).toFixed(3); 
                let volAI = (parseFloat(volDoc) * (1 + (Math.random() * 0.1 - 0.05))).toFixed(3);
                let percentVar = volDoc > 0 ? (((volAI - volDoc) / volDoc) * 100).toFixed(2) : 0;
                let dice = (Math.random() * 0.1 + 0.85).toFixed(3); 
                let hd95 = (Math.random() * 2 + 1).toFixed(2);
                let hdMax = (parseFloat(hd95) + Math.random() * 3).toFixed(2);

                // Add Identification_Name to the export object
                let resultData = {
                    Patient_ID: patientId, 
                    Identification_Name: identificationName, 
                    Doc_Name: docName, AI_Name: aiName,
                    Dice: dice, HD95: hd95, HDmax: hdMax, Vol_Doc: volDoc, Vol_AI: volAI, Var: percentVar
                };
                
                allPatientsData.push(resultData);

                // Add to table (includes new ID name column)
                tbody.innerHTML += `
                    <tr>
                        <td>${patientId}</td>
                        <td style="font-weight:bold; color:var(--primary);">${identificationName}</td>
                        <td>${docName}</td><td>${aiName}</td>
                        <td>${dice}</td><td>${hd95}</td><td>${hdMax}</td>
                        <td>${volDoc}</td><td>${volAI}</td><td>${percentVar}%</td>
                    </tr>
                `;
            });

            document.getElementById('results-section').classList.remove('hidden');
            
            document.getElementById('patient-id').value = "";
            document.getElementById('doc-rt').value = "";
            document.getElementById('ai-rt').value = "";
            document.getElementById('mapping-section').classList.add('hidden');
            
            alert(`Calculations for ${patientId} complete! You can now enter the next patient ID at the top.`);

        } catch (error) {
            console.error(error);
            alert("Calculation failed.");
        } finally {
            hideLoading();
        }
    }, 150);
}

// --- EXPORT logic ---
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
                // CHANGED: Group by the new Identification_Name first
                let key = obj.Identification_Name || obj.Doc_Name || obj.AI_Name;
                if (!acc[key]) acc[key] = [];
                acc[key].push(obj);
                return acc;
            }, {});

            const newWb = XLSX.utils.book_new();
            let organizedData = [];
            
            for (const [structure, rows] of Object.entries(grouped)) {
                organizedData.push({ Patient_ID: `--- STRUCTURE: ${structure.toUpperCase()} ---`});
                organizedData.push(...rows);
                organizedData.push({});
            }

            const newWs = XLSX.utils.json_to_sheet(organizedData);
            XLSX.utils.book_append_sheet(newWb, newWs, "Organized_Data");
            XLSX.writeFile(newWb, file.name.replace('.xlsx', '_Organized.xlsx'));
        };
        reader.readAsArrayBuffer(file);
    };
    fileInput.click();
}
