// IndexedDB Setup
const DB_NAME = 'DiaryDB';
const DB_VERSION = 1;
const STORE_NAME = 'entries';

let db;

const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('Database error:', event.target.error);
            reject('Error opening DB');
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            db = event.target.result;
            const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            objectStore.createIndex('date', 'date', { unique: false });
        };
    });
};

const addEntry = (entry) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(entry);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
};

const getAllEntries = () => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            // Sort by latest
            const entries = request.result.sort((a, b) => b.timestamp - a.timestamp);
            resolve(entries);
        };
        request.onerror = (event) => reject(event.target.error);
    });
};

const deleteEntry = (id) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
};

// UI Logic
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    renderEntries();

    const writeBtn = document.getElementById('writeBtn');
    const writeModal = document.getElementById('writeModal');
    const closeBtns = document.querySelectorAll('.close-btn');
    const diaryForm = document.getElementById('diaryForm');
    const photoInput = document.getElementById('photoInput');
    const photoPreview = document.getElementById('photoPreview');
    const previewImg = document.getElementById('previewImg');
    const uploadLabel = document.querySelector('.upload-label');
    const removePhotoBtn = document.getElementById('removePhotoBtn');
    const diaryText = document.getElementById('diaryText');
    const charCount = document.getElementById('charCount');

    let currentImageDataUrl = null;

    // Modal Control
    writeBtn.addEventListener('click', () => {
        writeModal.classList.remove('hidden');
        resetForm();
    });

    closeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.target.closest('.modal').classList.add('hidden');
        });
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.add('hidden');
        }
    });

    // Character Counter
    diaryText.addEventListener('input', () => {
        const length = diaryText.value.length;
        charCount.textContent = length;
        if (length >= 1000) {
            charCount.style.color = 'red';
        } else {
            charCount.style.color = '#777';
        }
    });

    // Photo Upload & Preview
    photoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                resizeImage(event.target.result, 800, (resizedDataUrl) => {
                    currentImageDataUrl = resizedDataUrl;
                    previewImg.src = currentImageDataUrl;
                    uploadLabel.style.display = 'none';
                    photoPreview.classList.remove('hidden');
                });
            };
            reader.readAsDataURL(file);
        }
    });

    removePhotoBtn.addEventListener('click', () => {
        currentImageDataUrl = null;
        photoInput.value = '';
        previewImg.src = '';
        uploadLabel.style.display = 'flex';
        photoPreview.classList.add('hidden');
    });

    // Form Submit
    diaryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!currentImageDataUrl) {
            alert('사진을 선택해주세요!');
            return;
        }

        const text = diaryText.value.trim();
        if (!text) {
            alert('내용을 입력해주세요!');
            return;
        }

        const now = new Date();
        const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

        const entry = {
            date: dateStr,
            timestamp: now.getTime(),
            image: currentImageDataUrl,
            text: text
        };

        try {
            await addEntry(entry);
            writeModal.classList.add('hidden');
            renderEntries();
            resetForm();
        } catch (error) {
            console.error('Save failed:', error);
            alert('저장에 실패했습니다.');
        }
    });

    // Reset Form
    function resetForm() {
        diaryForm.reset();
        currentImageDataUrl = null;
        uploadLabel.style.display = 'flex';
        photoPreview.classList.add('hidden');
        charCount.textContent = '0';
        charCount.style.color = '#777';
    }

    // Render Entries
    async function renderEntries() {
        const diaryList = document.getElementById('diaryList');
        diaryList.innerHTML = '';

        try {
            const entries = await getAllEntries();
            
            if (entries.length === 0) {
                diaryList.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #8c2f39; padding: 40px; font-family: var(--font-title); font-size: 1.8rem;">첫 번째 일기를 남겨보세요!</p>';
                return;
            }

            entries.forEach(entry => {
                const card = document.createElement('div');
                card.className = 'diary-card';
                card.innerHTML = `
                    <div class="card-img-wrapper">
                        <img src="${entry.image}" alt="다이어리 사진">
                    </div>
                    <div class="card-date">${entry.date}</div>
                    <div class="card-text">${escapeHTML(entry.text)}</div>
                    <button class="delete-card-btn" data-id="${entry.id}">삭제</button>
                `;

                // Add delete event
                card.querySelector('.delete-card-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm('이 기록을 삭제하시겠습니까?')) {
                        await deleteEntry(entry.id);
                        renderEntries();
                    }
                });

                diaryList.appendChild(card);
            });
        } catch (error) {
            console.error('Load failed:', error);
        }
    }

    // Helper: Resize Image
    function resizeImage(base64Str, maxWidth, callback) {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            } else {
                callback(base64Str);
                return;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', 0.8));
        };
    }

    // Helper: Escape HTML
    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag])
        );
    }
});
