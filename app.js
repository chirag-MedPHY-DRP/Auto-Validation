// --- GLOBAL VARIABLES ---
let allPatientsData = [];
let currentMapping = {};
let docStructures = [];
let aiStructures = [];

// --- HELPER FUNCTIONS ---
function showLoading(message) {
    document.getElementById('loading-text').innerText = message || "Processing...";
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

// --- CORE LOGIC ---
async function processFiles() {
    console.log("processFiles function triggered.");
    const patientId = document.getElementById('patient-id').value;
    const docFile = document.getElementById('doc-rt').files[0];
    const aiFile = document.getElementById('ai-rt').files[0];

    // Validation check
    if (!patientId || !docFile || !aiFile) {
        alert("Please fill in the Patient ID and select both RTStruct files.");
        return;
    }

    // Show spinner
    showLoading("Parsing DICOM files and auto-mapping structures...");

    // Pause for 150ms to allow the browser to draw the loading screen
    setTimeout(() => {
        try {
            // MOCK DATA: Simulating structure extraction
            docStructures = ["BrainStem", "Chiasm", "L_Eye", "R_Eye", "OpticNerve_L"];
            aiStructures = ["BrainStem", "Chiasm", "Eye_L", "Eye_R", "Optic_Nerve_L"];
            
            autoMapStructures(docStructures, aiStructures);
            
            document.getElementById('mapping-section').classList.remove('hidden');
            console.log("Mapping complete.");
        } catch (error) {
            console.error("Error during mapping:", error);
            alert("An error occurred during mapping. Check the console for details.");
        } finally {
            // Always hide spinner when done
            hideLoading();
        }
    }, 150);
}

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
            // 2. Fuzzy Match using string-similarity library
            const matches = stringSimilarity.findBestMatch(docName, availableAi);
            if (matches.bestMatch.rating >= 0.6) {
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
}

function runCalculations() {
    const patientId = document.getElementById('patient-id').value;
    const tbody = document.getElementById('results-body');
    
    if (Object.keys(currentMapping).length === 0) {
        alert("No mapped structures to calculate!");
        return;
    }

    showLoading("Running volumetric and HD95 calculations...");

    setTimeout(() => {
        try {
            Object.keys(currentMapping).forEach(docName => {
                const aiName = currentMapping[docName];
                
                // MOCK MATH: Simulating the heavy Python backend calculations
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
        } catch (error) {
            console.error("Error during calculation:", error);
            alert("Calculation failed. Check the console for details.");
        } finally {
            hideLoading();
        }
    }, 150);
}

function exportToExcel() {
    if (allPatientsData.length === 0) {
        alert("No data to export!");
        return;
    }
    const ws = XLSX.utils.json_to_sheet(allPatientsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    XLSX.writeFile(wb, "Contour_Comparison_Results.xlsx");
}

function organizeExcel() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx';
    
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        
        reader.onload = function(event) {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet);
            
            const grouped = json.reduce((acc, obj) => {
                let key = obj.Doc_Name || obj.AI_Name;
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
