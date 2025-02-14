const { dbFiles } = require('../routes/db-config');
const { dbLogins } = require('../routes/db-config');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const createStorage = (req, res) => {
    const { storageName, selectedFiles } = req.body;
    const safeId = req.user.safeid_users;
    const currentDate = new Date();

    console.log('DEBUG: Rozpoczęto tworzenie magazynu...');
    console.log('Dane wejściowe:', { storageName, selectedFiles, safeId });

    if (!storageName || typeof storageName !== 'string' || !storageName.trim()) {
        console.log('Błąd: Nazwa magazynu jest wymagana');
        return res.status(400).json({ status: 'error', error: 'Nazwa magazynu jest wymagana' });
    }

    dbFiles.query(
        'INSERT INTO storages (name_storages, owner_storages, date_storages, active_storages) VALUES (?, ?, ?, 1)',
        [storageName, safeId, currentDate],
        (err, result) => {
            if (err) {
                console.error('DEBUG: Błąd przy tworzeniu magazynu:', err);
                return res.status(500).json({ status: 'error', error: 'Błąd serwera podczas tworzenia magazynu' });
            }

            const storageId = result.insertId;
            console.log('DEBUG: Utworzono magazyn z ID:', storageId);

            const storagePath = path.join(__dirname, '..', 'data', 'storages', safeId, storageId.toString());
            if (!fs.existsSync(storagePath)) {
                fs.mkdirSync(storagePath, { recursive: true });
                console.log(`DEBUG: Utworzono katalog dla magazynu: ${storagePath}`);
            }

            if (selectedFiles && Array.isArray(selectedFiles) && selectedFiles.length > 0) {
                console.log('DEBUG: Wybrane pliki do dodania (originalname_files):', selectedFiles);

                dbFiles.query(
                    'SELECT * FROM files WHERE originalname_files IN (?) AND cryptedowner_files = ? AND delete_files = 0',
                    [selectedFiles, safeId],
                    (err, files) => {
                        if (err) {
                            console.error('DEBUG: Błąd podczas weryfikacji plików:', err);
                            return res.status(500).json({ status: 'error', error: 'Błąd serwera podczas weryfikacji plików' });
                        }

                        const storageFilesValues = [];
                        const fileInsertPromises = files.map(file => {
                            const originalPath = path.join(__dirname, '..', 'data', 'users', safeId, file.cryptedname_files);
                            const newCryptedName = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname_files);
                            const newPath = path.join(storagePath, newCryptedName);

                            return new Promise((resolve, reject) => {
                                fs.copyFile(originalPath, newPath, err => {
                                    if (err) {
                                        console.error('DEBUG: Błąd podczas kopiowania pliku:', err);
                                        return reject(err);
                                    }

                                    console.log(`DEBUG: Skopiowano plik: ${file.originalname_files} -> ${newPath}`);

                                    // Dodaj nowy wpis w tabeli `files` z origin_file ustawionym na "storage"
                                    dbFiles.query(
                                        'INSERT INTO files (originalname_files, cryptedname_files, cryptedowner_files, filetype_files, delete_files, dateofupload_files, origin_file) VALUES (?, ?, ?, ?, 0, ?, ?)',
                                        [file.originalname_files, newCryptedName, safeId, file.filetype_files, currentDate, 'storage'],
                                        (err, result) => {
                                            if (err) {
                                                console.error('DEBUG: Błąd podczas dodawania pliku do bazy:', err);
                                                return reject(err);
                                            }

                                            const newFileId = result.insertId;
                                            storageFilesValues.push([storageId, newFileId, currentDate, 1, safeId]);
                                            resolve();
                                        }
                                    );
                                });
                            });
                        });

                        Promise.all(fileInsertPromises)
                            .then(() => {
                                // Dodaj wpisy do tabeli `storages_files`
                                dbFiles.query(
                                    'INSERT INTO storages_files (id_storages, id_files, date_storages_file, active_storages_files, modificator_storages_files) VALUES ?',
                                    [storageFilesValues],
                                    (err) => {
                                        if (err) {
                                            console.error('DEBUG: Błąd przy dodawaniu plików do magazynu:', err);
                                            return res.status(500).json({ status: 'error', error: 'Błąd serwera podczas dodawania plików do magazynu' });
                                        }

                                        console.log('DEBUG: Magazyn i pliki zostały pomyślnie dodane.');
                                        return res.json({ status: 'success', message: 'Magazyn został utworzony wraz z plikami' });
                                    }
                                );
                            })
                            .catch(err => {
                                console.error('DEBUG: Błąd podczas przetwarzania plików:', err);
                                res.status(500).json({ status: 'error', error: 'Błąd serwera podczas przetwarzania plików' });
                            });
                    }
                );
            } else {
                console.log('DEBUG: Magazyn utworzony bez plików');
                return res.json({ status: 'success', message: 'Magazyn został utworzony' });
            }
        }
    );
};

const getUserStorages = (req, res) => {
    const userId = req.user.safeid_users;

    dbFiles.query(
        'SELECT * FROM storages WHERE owner_storages = ? AND active_storages = 1',
        [userId],
        (err, results) => {
            if (err) {
                console.error('Błąd podczas pobierania magazynów:', err);
                return res.status(500).json({ status: 'error', error: 'Błąd serwera podczas pobierania magazynów.' });
            }

            res.json({ status: 'success', storages: results });
        }
    );
};

const getStorageDetails = (req, res) => {
    const storageId = req.params.id; // ID magazynu z URL
    const userId = req.user.safeid_users; // ID zalogowanego użytkownika

    // Pobierz szczegóły magazynu z bazy danych
    dbFiles.query(
        `SELECT * FROM storages WHERE id_storages = ? AND active_storages = 1`,
        [storageId],
        (err, storageResults) => {
            if (err) {
                console.error("Błąd podczas pobierania szczegółów magazynu:", err);
                return res.status(500).send("Błąd serwera");
            }

            if (storageResults.length === 0) {
                return res.status(404).send("Magazyn nie istnieje lub został usunięty.");
            }

            const storage = storageResults[0];

            // Sprawdź, czy użytkownik jest właścicielem magazynu
            const isOwner = storage.owner_storages === userId;

            // Pobierz pliki w magazynie
            dbFiles.query(
                `SELECT f.originalname_files, f.cryptedname_files, sf.date_storages_file 
                 FROM storages_files sf 
                 JOIN files f ON sf.id_files = f.id_files 
                 WHERE sf.id_storages = ? AND sf.active_storages_files = 1`,
                [storageId],
                (err, fileResults) => {
                    if (err) {
                        console.error("Błąd podczas pobierania plików magazynu:", err);
                        return res.status(500).send("Błąd serwera");
                    }

                    // Renderuj widok z magazynem
                    res.render("storage", {
                        storageName: storage.name_storages,
                        storageId: storage.id_storages,
                        files: fileResults,
                        isOwner: isOwner, // Przekazanie informacji, czy użytkownik jest właścicielem
                    });
                }
            );
        }
    );
};



const getFileFromStorage = (req, res) => {
    const fileId = req.params.fileId;
    const storageId = req.query.storageId;

    if (!storageId) {
        console.error('DEBUG: Brak ID magazynu.');
        return res.status(400).json({ status: 'error', error: 'Brak ID magazynu.' });
    }

    // Pobierz owner_storages na podstawie storageId
    dbFiles.query(
        'SELECT owner_storages FROM storages WHERE id_storages = ? AND active_storages = 1',
        [storageId],
        (err, storageResults) => {
            if (err) {
                console.error('Błąd pobierania informacji o magazynie:', err);
                return res.status(500).json({ status: 'error', error: 'Błąd serwera podczas pobierania informacji o magazynie.' });
            }

            if (storageResults.length === 0) {
                console.error('DEBUG: Magazyn nie istnieje lub jest nieaktywny.');
                return res.status(404).json({ status: 'error', error: 'Magazyn nie istnieje lub jest nieaktywny.' });
            }

            const safeId = storageResults[0].owner_storages; // Użycie owner_storages jako safeId
            console.log('DEBUG: safeId uzyskane z magazynu:', safeId);

            // Sprawdź, czy plik należy do użytkownika
            dbFiles.query(
                'SELECT cryptedname_files, originalname_files FROM files WHERE cryptedname_files = ?',
                [fileId],
                (err, fileResults) => {
                    if (err) {
                        console.error('Błąd pobierania informacji o pliku:', err);
                        return res.status(500).json({ status: 'error', error: 'Błąd serwera podczas pobierania pliku.' });
                    }

                    if (fileResults.length === 0) {
                        console.error('DEBUG: Plik nie istnieje lub brak dostępu.');
                        return res.status(404).json({ status: 'error', error: 'Plik nie istnieje lub brak dostępu.' });
                    }

                    const filePath = path.join(__dirname, '..', 'data', 'storages', safeId, storageId, fileId);
                    console.log('DEBUG: Ścieżka do pliku:', filePath);

                    if (!fs.existsSync(filePath)) {
                        console.error('DEBUG: Plik nie istnieje:', filePath);
                        return res.status(404).json({ status: 'error', error: 'Plik nie istnieje.' });
                    }

                    // Odczytaj zawartość pliku
                    fs.readFile(filePath, 'utf8', (err, data) => {
                        if (err) {
                            console.error('Błąd podczas czytania pliku:', err);
                            return res.status(500).json({ status: 'error', error: 'Błąd podczas czytania pliku.' });
                        }

                        res.json({ status: 'success', content: data });
                    });
                }
            );
        }
    );
};


const saveFileStorageContent = (req, res) => {
    const cryptedName = req.params.fileId; // cryptedname_files
    const storageId = req.query.storageId;
    const safeId = req.user.safeid_users;
    const { content, currentVersion } = req.body; // Pobieramy wersję z przekazanych danych

    console.log('DEBUG: Rozpoczęcie zapisu pliku do magazynu.');
    console.log(`DEBUG: fileId: ${cryptedName}`);
    console.log(`DEBUG: storageId: ${storageId}`);
    console.log(`DEBUG: safeId: ${safeId}`);
    console.log(`DEBUG: Aktualna wersja: ${currentVersion}`);
    console.log(`DEBUG: Długość zawartości: ${content ? content.length : 'brak zawartości'}`);

    if (!cryptedName || !storageId || !content) {
        console.error('DEBUG: Błąd - Brak wymaganych danych');
        return res.status(400).json({ status: 'error', error: 'Brak wymaganych danych' });
    }

    const filePath = path.join(__dirname, '..', 'data', 'storages', safeId, storageId, cryptedName);
    console.log(`DEBUG: Ścieżka do pliku: ${filePath}`);

    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
        console.error(`DEBUG: Katalog nie istnieje: ${dirPath}`);
        return res.status(500).json({ status: 'error', error: 'Ścieżka do zapisu pliku nie istnieje.' });
    }

    // Znajdź `id_files` na podstawie `cryptedname_files`
    dbFiles.query(
        `SELECT id_files FROM files WHERE cryptedname_files = ?`,
        [cryptedName],
        (err, fileResults) => {
            if (err) {
                console.error(`DEBUG: Błąd podczas pobierania id_files: ${err.message}`);
                return res.status(500).json({ status: 'error', error: 'Błąd podczas wyszukiwania pliku.' });
            }

            if (fileResults.length === 0) {
                console.error('DEBUG: Plik nie został znaleziony w tabeli `files`.');
                return res.status(404).json({ status: 'error', error: 'Plik nie został znaleziony.' });
            }

            const fileId = fileResults[0].id_files;
            console.log(`DEBUG: Znaleziono id_files: ${fileId}`);

            // Pobierz wersję pliku z tabeli `storages_files`
            dbFiles.query(
                `SELECT file_version_storages_files 
                 FROM storages_files 
                 WHERE id_storages = ? AND id_files = ? AND active_storages_files = 1`,
                [storageId, fileId],
                (err, results) => {
                    if (err) {
                        console.error(`DEBUG: Błąd podczas pobierania wersji pliku: ${err.message}`);
                        return res.status(500).json({ status: 'error', error: 'Błąd podczas pobierania wersji pliku.' });
                    }

                    if (results.length === 0) {
                        console.error('DEBUG: Plik nie został znaleziony w tabeli `storages_files`.');
                        return res.status(404).json({ status: 'error', error: 'Plik nie został znaleziony w magazynie.' });
                    }

                    const dbVersion = results[0].file_version_storages_files || 1; // Domyślnie 1, jeśli brak wersji
                    console.log(`DEBUG: Wersja pliku w bazie danych: Ver. ${dbVersion}`);

                    // Porównanie wersji
                    if (dbVersion !== currentVersion) {
                        console.error(
                            `DEBUG: Konflikt wersji pliku. Wersja w bazie: ${dbVersion}, przesłana wersja: ${currentVersion}`
                        );
                        return res.status(409).json({
                            status: 'error',
                            error: `Konflikt wersji pliku. Oczekiwana wersja: Ver. ${dbVersion}`,
                        });
                    }

                    // Zapisanie pliku na dysku
                    fs.writeFile(filePath, content, 'utf8', (err) => {
                        if (err) {
                            console.error(`DEBUG: Błąd zapisu pliku: ${err.message}`);
                            return res.status(500).json({ status: 'error', error: 'Błąd podczas zapisywania pliku.' });
                        }

                        console.log(`DEBUG: Plik zapisany pomyślnie: ${filePath}`);

                        // Zwiększenie wersji pliku
                        const newVersion = dbVersion + 1;

                        dbFiles.query(
                            `UPDATE storages_files 
                             SET file_version_storages_files = ?, date_storages_file = NOW() 
                             WHERE id_storages = ? AND id_files = ?`,
                            [newVersion, storageId, fileId],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error(`DEBUG: Błąd podczas aktualizacji wersji pliku: ${updateErr.message}`);
                                    return res.status(500).json({ status: 'error', error: 'Błąd podczas aktualizacji wersji pliku.' });
                                }

                                console.log(`DEBUG: Wersja pliku zaktualizowana do Ver. ${newVersion}`);
                                res.json({ status: 'success', message: `Plik został zapisany pomyślnie. Aktualna wersja: Ver. ${newVersion}` });
                            }
                        );
                    });
                }
            );
        }
    );
};

const addFilesToStorage = async (req, res) => {
    const { storageId } = req.params;
    const safeId = req.user.safeid_users;
    const { selectedFiles } = req.body;

    console.log(`DEBUG: Rozpoczęcie dodawania plików do magazynu. storageId: ${storageId}, safeId: ${safeId}`);
    console.log(`DEBUG: Wybrane pliki: ${selectedFiles.join(', ')}`);

    if (!selectedFiles || !Array.isArray(selectedFiles) || selectedFiles.length === 0) {
        return res.status(400).json({ status: 'error', error: 'Brak wybranych plików do dodania.' });
    }

    const storagePath = path.join(__dirname, '..', 'data', 'storages', safeId, storageId);

    if (!fs.existsSync(storagePath)) {
        return res.status(404).json({ status: 'error', error: 'Magazyn nie istnieje.' });
    }

    try {
        const files = await new Promise((resolve, reject) => {
            dbFiles.query(
                'SELECT * FROM files WHERE originalname_files IN (?) AND cryptedowner_files = ? AND delete_files = 0',
                [selectedFiles, safeId],
                (err, results) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(results);
                }
            );
        });

        const currentDate = new Date();
        const storageFilesValues = [];

        for (const file of files) {
            const sourcePath = path.join(__dirname, '..', 'data', 'users', safeId, file.cryptedname_files);

            // Sprawdzenie unikalności `originalname_files`
            let newOriginalName = file.originalname_files;
            const fileExtension = path.extname(file.originalname_files);
            const fileBaseName = path.basename(file.originalname_files, fileExtension);

            let suffix = 0;
            let isOriginalNameUnique = false;

            while (!isOriginalNameUnique) {
                const conflictingFiles = await new Promise((resolve, reject) => {
                    dbFiles.query(
                        `SELECT f.originalname_files 
                         FROM storages_files sf 
                         JOIN files f ON sf.id_files = f.id_files 
                         WHERE sf.id_storages = ? AND f.originalname_files = ? AND sf.active_storages_files = 1`,
                        [storageId, newOriginalName],
                        (err, results) => {
                            if (err) {
                                return reject(err);
                            }
                            resolve(results);
                        }
                    );
                });

                if (conflictingFiles.length > 0) {
                    suffix++;
                    newOriginalName = `${fileBaseName}(${suffix})${fileExtension}`;
                } else {
                    isOriginalNameUnique = true;
                }
            }

            if (fs.existsSync(sourcePath)) {
                // Generowanie nowej `cryptedname_files`
                const newCryptedName = `${crypto.randomBytes(16).toString('hex')}${fileExtension}`;
                const destPath = path.join(storagePath, newCryptedName);

                // Kopiowanie pliku do magazynu z nową nazwą
                fs.copyFileSync(sourcePath, destPath);
                console.log(`DEBUG: Skopiowano plik: ${file.cryptedname_files} -> ${destPath}`);

                // Dodanie nowego wpisu w tabeli `files`
                const newFileId = await new Promise((resolve, reject) => {
                    dbFiles.query(
                        `INSERT INTO files (originalname_files, cryptedname_files, cryptedowner_files, filetype_files, delete_files, dateofupload_files, origin_file, oldcryptedname_file) 
                         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
                        [
                            newOriginalName, // Zmieniona nazwa
                            newCryptedName, // Nowa zaszyfrowana nazwa
                            safeId, // Właściciel
                            file.filetype_files, // Typ pliku
                            currentDate, // Data przesłania
                            'storage', // Źródło pliku
                            file.cryptedname_files, // Stara zaszyfrowana nazwa
                        ],
                        (err, result) => {
                            if (err) {
                                return reject(err);
                            }
                            resolve(result.insertId);
                        }
                    );
                });

                // Dodanie wpisu do tabeli `storages_files`
                storageFilesValues.push([
                    storageId,
                    newFileId, // ID nowego wpisu w tabeli `files`
                    currentDate,
                    1, // active_storages_files
                    safeId,
                    1, // file_version_storages_files
                ]);
            } else {
                console.warn(`DEBUG: Plik nie istnieje: ${sourcePath}`);
            }
        }

        if (storageFilesValues.length > 0) {
            await new Promise((resolve, reject) => {
                dbFiles.query(
                    'INSERT INTO storages_files (id_storages, id_files, date_storages_file, active_storages_files, modificator_storages_files, file_version_storages_files) VALUES ?',
                    [storageFilesValues],
                    (err) => {
                        if (err) {
                            return reject(err);
                        }
                        resolve();
                    }
                );
            });
        }

        console.log('DEBUG: Pliki zostały pomyślnie dodane do magazynu.');
        res.json({ status: 'success', message: 'Pliki zostały dodane do magazynu.' });
    } catch (err) {
        console.error(`DEBUG: Błąd podczas dodawania plików do magazynu: ${err.message}`);
        res.status(500).json({ status: 'error', error: 'Błąd podczas dodawania plików do magazynu.' });
    }
};




const removeFileFromStorage = (req, res) => {
    const { storageId, fileId } = req.params; // Pobierz ID magazynu i pliku z parametrów
    const safeId = req.user.safeid_users; // Pobierz ID użytkownika z sesji

    console.log(`DEBUG: Rozpoczęcie usuwania pliku z magazynu. storageId: ${storageId}, fileId: ${fileId}, safeId: ${safeId}`);

    // Znajdź plik na podstawie `cryptedname_files`
    dbFiles.query(
        `SELECT id_files, originalname_files FROM files WHERE cryptedname_files = ? AND cryptedowner_files = ?`,
        [fileId, safeId],
        (err, results) => {
            if (err) {
                console.error('DEBUG: Błąd podczas wyszukiwania pliku:', err);
                return res.status(500).json({ status: 'error', error: 'Błąd serwera podczas wyszukiwania pliku.' });
            }

            if (results.length === 0) {
                return res.status(404).json({ status: 'error', error: 'Nie znaleziono pliku o podanym identyfikatorze.' });
            }

            const numericFileId = results[0].id_files;
            const originalName = results[0].originalname_files;

            // Dodaj "(deleted)" i losowy numer do nazwy pliku
            const randomNum = Math.floor(Math.random() * 1000).toString().padStart(4, '0');
            const newName = `${originalName}(deleted)${randomNum}`;

            // Aktualizuj aktywność w `storages_files`
            dbFiles.query(
                `UPDATE storages_files 
                 SET active_storages_files = 0 
                 WHERE id_storages = ? AND id_files = ? AND modificator_storages_files = ?`,
                [storageId, numericFileId, safeId],
                (err, result) => {
                    if (err) {
                        console.error('DEBUG: Błąd podczas usuwania pliku z magazynu:', err);
                        return res.status(500).json({ status: 'error', error: 'Błąd serwera podczas usuwania pliku z magazynu.' });
                    }

                    if (result.affectedRows === 0) {
                        return res.status(404).json({ status: 'error', error: 'Plik nie istnieje w magazynie lub brak uprawnień.' });
                    }

                    // Zaktualizuj nazwę pliku w `files`
                    dbFiles.query(
                        `UPDATE files 
                         SET originalname_files = ? 
                         WHERE id_files = ? AND cryptedowner_files = ?`,
                        [newName, numericFileId, safeId],
                        (err) => {
                            if (err) {
                                console.error("Błąd podczas aktualizacji nazwy pliku:", err);
                                return res.status(500).json({ status: "error", error: "Błąd serwera podczas aktualizacji nazwy pliku." });
                            }

                            console.log(`DEBUG: Nazwa pliku została zmieniona na: ${newName}`);
                            console.log('DEBUG: Plik został pomyślnie usunięty z magazynu.');
                            res.json({ status: 'success', message: 'Plik został pomyślnie usunięty z magazynu i nazwa została zaktualizowana.' });
                        }
                    );
                }
            );
        }
    );
};



const editFileName = (req, res) => {
    const { storageId, fileId } = req.params;
    const { newFileName } = req.body;
    const safeId = req.user.safeid_users;

    console.log("Rozpoczęto proces zmiany nazwy pliku");
    console.log("Parametry:", { storageId, fileId, newFileName, safeId });

    if (!newFileName || typeof newFileName !== "string" || !newFileName.trim()) {
        console.error("Błąd: Nazwa pliku nie może być pusta.");
        return res.status(400).json({ status: "error", error: "Nazwa pliku nie może być pusta." });
    }

    dbFiles.query(
        `SELECT * FROM storages_files sf 
         JOIN files f ON sf.id_files = f.id_files 
         WHERE sf.id_storages = ? AND f.cryptedname_files = ? AND sf.active_storages_files = 1`,
        [storageId, fileId],
        (err, results) => {
            if (err) {
                console.error("Błąd podczas wyszukiwania pliku:", err);
                return res.status(500).json({ status: "error", error: "Błąd serwera." });
            }

            if (results.length === 0) {
                console.error("Plik nie istnieje w magazynie.");
                return res.status(404).json({ status: "error", error: "Plik nie istnieje w magazynie." });
            }

            const fileIdNumeric = results[0].id_files;
            console.log("Znaleziono plik. ID pliku:", fileIdNumeric);

            dbFiles.query(
                "UPDATE files SET originalname_files = ? WHERE id_files = ? AND cryptedowner_files = ?",
                [newFileName, fileIdNumeric, safeId],
                (err) => {
                    if (err) {
                        console.error("Błąd podczas aktualizacji nazwy pliku:", err);
                        return res.status(500).json({ status: "error", error: "Błąd serwera podczas aktualizacji nazwy pliku." });
                    }

                    console.log(`Nazwa pliku została zmieniona na: ${newFileName}`);
                    res.json({ status: "success", message: "Nazwa pliku została zmieniona pomyślnie." });
                }
            );
        }
    );
};

const shareStorage = (req, res) => {
    const { storageId, friends } = req.body;
    const ownerId = req.user.safeid_users;

    // Weryfikacja, czy magazyn istnieje i należy do zalogowanego użytkownika
    dbFiles.query(
        'SELECT * FROM storages WHERE id_storages = ? AND owner_storages = ? AND active_storages = 1',
        [storageId, ownerId],
        (err, results) => {
            if (err) {
                console.error('Błąd podczas weryfikacji magazynu:', err);
                return res.status(500).json({ status: 'error', error: 'Błąd serwera.' });
            }

            if (results.length === 0) {
                return res.status(403).json({ status: 'error', error: 'Nie masz uprawnień do udostępnienia tego magazynu.' });
            }

            // Dodanie rekordów do tabeli udostępnień
            const sharePromises = friends.map(friendId => {
                return new Promise((resolve, reject) => {
                    dbFiles.query(
                        'INSERT INTO storages_shared (id_storages, id_user, shared_date) VALUES (?, ?, NOW())',
                        [storageId, friendId],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
            });

            Promise.all(sharePromises)
                .then(() => {
                    res.json({ status: 'success', message: 'Magazyn został udostępniony.' });
                })
                .catch(err => {
                    console.error('Błąd podczas udostępniania magazynu:', err);
                    res.status(500).json({ status: 'error', error: 'Błąd podczas udostępniania magazynu.' });
                });
        }
    );
};

const shareStorageWithMembers = (req, res) => {
    const storageId = parseInt(req.body.storageId, 10); // Konwersja na liczbę
    const friends = req.body.friends;
    const modificatorId = req.user.safeid_users;
    const currentDate = new Date();

    if (!storageId || isNaN(storageId) || !friends || !Array.isArray(friends) || friends.length === 0) {
        return res.status(400).json({ status: 'error', error: 'Nieprawidłowe dane wejściowe.' });
    }

    const values = friends.map(friendId => [
        storageId,
        friendId,
        currentDate,
        modificatorId,
        1
    ]);

    dbLogins.query(
        `INSERT INTO members_storages (id_storage_members_storages, id_user_members_storages, date_members_storages, modificator_members_storages, active_members_storages) 
         VALUES ?`,
        [values],
        (err) => {
            if (err) {
                console.error('Błąd podczas zapisu do tabeli members_storages:', err);
                return res.status(500).json({ status: 'error', error: 'Błąd serwera podczas udostępniania magazynu.' });
            }

            res.json({ status: 'success', message: 'Magazyn został udostępniony wybranym znajomym.' });
        }
    );
};

const saveConflictedFile = (req, res) => {
    const cryptedName = req.query.fileId; // Pobierz ID pliku z query
    const storageId = req.query.storageId;
    const safeId = req.user.safeid_users;
    const { content } = req.body; // Zawartość pliku od użytkownika

    console.log('DEBUG: Rozpoczęcie obsługi konfliktu pliku.');
    console.log(`DEBUG: fileId: ${cryptedName}`);
    console.log(`DEBUG: storageId: ${storageId}`);
    console.log(`DEBUG: safeId: ${safeId}`);
    console.log(`DEBUG: Długość zawartości: ${content ? content.length : 'brak zawartości'}`);

    if (!cryptedName || !storageId || !content) {
        console.error('DEBUG: Brak wymaganych danych');
        return res.status(400).json({ status: 'error', error: 'Brak wymaganych danych' });
    }

    // Ścieżka do oryginalnego pliku na serwerze
    const filePath = path.join(__dirname, '..', 'data', 'storages', safeId, storageId, cryptedName);

    // Katalog tymczasowy
    const tempDir = path.join(__dirname, '..', 'data', 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }

    // Ścieżki do plików tymczasowych
    const tempFilePath = path.join(tempDir, cryptedName); // Kopia pliku z serwera
    const tempFilePathTmp = path.join(
        tempDir,
        `${path.basename(cryptedName, path.extname(cryptedName))}_tmp${path.extname(cryptedName)}`
    ); // Kopia aktualnych zmian użytkownika

    try {
        // Tworzenie pliku tymczasowego `ABC.txt` (kopia pliku z serwera)
        if (fs.existsSync(filePath)) {
            fs.copyFileSync(filePath, tempFilePath);
            console.log(`DEBUG: Utworzono kopię pliku z serwera: ${tempFilePath}`);
        } else {
            console.warn(`DEBUG: Plik z serwera nie istnieje: ${filePath}`);
        }

        // Tworzenie pliku tymczasowego `ABC_tmp.txt` (kopia zmian użytkownika)
        fs.writeFileSync(tempFilePathTmp, content, 'utf8');
        console.log(`DEBUG: Utworzono kopię zmian użytkownika: ${tempFilePathTmp}`);

        // Zwróć sukces
        res.json({
            status: 'success',
            message: 'Pliki konfliktowe zostały utworzone.',
            tempFilePath,
            tempFilePathTmp,
        });
    } catch (err) {
        console.error('DEBUG: Błąd podczas obsługi konfliktu pliku:', err);
        res.status(500).json({ status: 'error', error: 'Wystąpił błąd podczas obsługi konfliktu pliku.' });
    }
};

const saveResolvedFileContent = (req, res) => {
    const cryptedName = req.params.fileId; // cryptedname_files
    const storageId = req.query.storageId; // Pobieramy z query string
    const safeId = req.user.safeid_users; // Użytkownik aktualnie zalogowany
    const { content } = req.body; // Nowa zawartość pliku

    console.log('DEBUG: Rozpoczęcie zapisu rozwiązanej zawartości pliku.');
    console.log(`DEBUG: fileId: ${cryptedName}`);
    console.log(`DEBUG: storageId: ${storageId}`);
    console.log(`DEBUG: safeId: ${safeId}`);
    console.log(`DEBUG: Długość zawartości: ${content ? content.length : 'brak zawartości'}`);

    if (!cryptedName || !storageId || !content) {
        console.error('DEBUG: Brak wymaganych danych');
        return res.status(400).json({ status: 'error', error: 'Brak wymaganych danych' });
    }

    const filePath = path.join(__dirname, '..', 'data', 'storages', safeId, storageId, cryptedName);
    console.log(`DEBUG: Ścieżka do pliku: ${filePath}`);

    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
        console.error(`DEBUG: Katalog nie istnieje: ${dirPath}`);
        return res.status(500).json({ status: 'error', error: 'Ścieżka do zapisu pliku nie istnieje.' });
    }

    dbFiles.query(
        `SELECT f.id_files, sf.file_version_storages_files 
         FROM storages_files sf 
         JOIN files f ON sf.id_files = f.id_files 
         WHERE f.cryptedname_files = ? AND sf.id_storages = ?`,
        [cryptedName, storageId],
        (err, results) => {
            if (err) {
                console.error(`DEBUG: Błąd podczas pobierania pliku: ${err.message}`);
                return res.status(500).json({ status: 'error', error: 'Błąd podczas wyszukiwania pliku.' });
            }
    
            if (results.length === 0) {
                console.error('DEBUG: Plik nie został znaleziony.');
                return res.status(404).json({ status: 'error', error: 'Plik nie został znaleziony.' });
            }
    
            const fileId = results[0].id_files;
            const currentVersion = results[0].file_version_storages_files || 1;
            const newVersion = currentVersion + 1;

            // Zapisanie pliku na dysku
            fs.writeFile(filePath, content, 'utf8', (err) => {
                if (err) {
                    console.error(`DEBUG: Błąd zapisu pliku: ${err.message}`);
                    return res.status(500).json({ status: 'error', error: 'Błąd podczas zapisywania pliku.' });
                }

                console.log(`DEBUG: Plik zapisany pomyślnie: ${filePath}`);

                // Aktualizacja wersji pliku w bazie danych
                dbFiles.query(
                    `UPDATE storages_files 
                     SET file_version_storages_files = ?, date_storages_file = NOW() 
                     WHERE id_storages = ? AND id_files = ?`,
                    [newVersion, storageId, fileId],
                    (updateErr) => {
                        if (updateErr) {
                            console.error(`DEBUG: Błąd podczas aktualizacji wersji pliku: ${updateErr.message}`);
                            return res.status(500).json({ status: 'error', error: 'Błąd podczas aktualizacji wersji pliku.' });
                        }

                        console.log(`DEBUG: Wersja pliku zaktualizowana do Ver. ${newVersion}`);
                        res.json({ status: 'success', message: `Plik zapisany pomyślnie. Aktualna wersja: Ver. ${newVersion}` });
                    }
                );
            });
        }
    );
};


module.exports = {
    createStorage,
    getUserStorages,
    getStorageDetails,
    getFileFromStorage,
    saveFileStorageContent,
    addFilesToStorage,
    removeFileFromStorage,
    editFileName,
    shareStorage,
    shareStorageWithMembers,
    saveConflictedFile,
    saveResolvedFileContent
};

