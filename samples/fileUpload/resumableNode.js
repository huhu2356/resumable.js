const fs = require('fs');
const path = require('path');
const util = require('util');
const stream = require('stream');

class Resumable {

    constructor(temporaryFolder) {
        this.temporaryFolder = temporaryFolder;
        this.fileParameterName = 'file';
        if (!fs.existsSync(this.temporaryFolder)) {
            try {
                fs.mkdirSync(this.temporaryFolder);
            } catch (e) {
            }
        }
    }

    getChunkFilename(chunkNumber, identifier) {
        return path.join(this.temporaryFolder, `./resumable-${identifier}.${chunkNumber}`);
    }

    validateRequest(chunkNumber, chunkSize, totalSize, identifier, filename, fileSize) {
        // Check if the request is sane
        if (chunkNumber === 0 || chunkSize === 0 || totalSize === 0 || identifier.length === 0 || filename.length === 0) {
            return 'non_resumable_request';
        }
        const numberOfChunks = Math.max(Math.floor(totalSize / (chunkSize * 1.0)), 1);
        if (chunkNumber > numberOfChunks) {
            return 'invalid_chunkNumber';
        }

        if (!fileSize) {
            if (chunkNumber < numberOfChunks && fileSize !== chunkSize) {
                // The chunk in the POST request isn't the correct size
                return 'invalid_fileSize';
            }
            if (numberOfChunks > 1 && chunkNumber === numberOfChunks && fileSize !== ((totalSize % chunkSize) + chunkSize)) {
                // The chunks in the POST is the last one, and the fil is not the correct size
                return 'invalid_fileSize';
            }
            if (numberOfChunks === 1 && fileSize !== totalSize) {
                // The file is only a single chunk, and the data size does not fit
                return 'invalid_fileSize';
            }
        }

        return 'valid';
    }

    async post(req) {
        const fields = req.body.fields;
        const files = req.body.files;

        const chunkNumber = fields['resumableChunkNumber'];
        const chunkSize = fields['resumableChunkSize'];
        const totalSize = fields['resumableTotalSize'];
        const identifier = fields['resumableIdentifier'];
        const filename = fields['resumableFilename'];

        if (!files[this.fileParameterName] || !files[this.fileParameterName].size) {
            return { validation: 'invalid_resumable_request' };
        }

        const validation = this.validateRequest(chunkNumber, chunkSize, totalSize, identifier, filename, files[this.fileParameterName].size);
        if (validation === 'valid') {
            const chunkFilename = this.getChunkFilename(chunkNumber, identifier);
            try {
                fs.renameSync(files[this.fileParameterName].path, chunkFilename);
            } catch(e) {

            }
            let currentTestChunk = 1;
            const numberOfChunks = Math.max(Math.floor(totalSize / (chunkSize * 1.0)), 1);
            const testChunkExists = () => {
                const chunkExists = fs.existsSync(this.getChunkFilename(currentTestChunk, identifier));
                if (chunkExists) {
                    currentTestChunk++;
                    if (currentTestChunk > numberOfChunks) {
                        return { validation: 'done', filename, identifier };
                    } else {
                        return testChunkExists();
                    }
                } else {
                    return { validation: 'partly_done', filename, identifier };
                }
            }
            return testChunkExists();
        } else {
            return { validation, filename, identifier };
        }
    }

    write(identifier, writableStream, callback) {
        const pipeChunk = number => {
            const chunkFilename = this.getChunkFilename(number, identifier);
            fs.access(chunkFilename, err => {
                if (err) {
                    writableStream.end();
                    if (callback) callback();
                } else {
                    const sourceStream = fs.createReadStream(chunkFilename);
                    sourceStream.pipe(writableStream, {
                        end: false
                    });
                    sourceStream.once('end', () => {
                        pipeChunk(number + 1);
                    });
                }
            });
        }

        pipeChunk(1);
    }

    clean(identifier, options = {}) {
        const pipeChunkRm = number => {

            const chunkFilename = this.getChunkFilename(number, identifier);

            fs.access(chunkFilename, err => {
                if (err) {
                    if (options.onDone) options.onDone();
                } else {
                    fs.unlink(chunkFilename, err => {
                        if (err && options.onError) options.onError(err);
                    });

                    pipeChunkRm(number + 1);
                }
            });
        }
        pipeChunkRm(1);
    }
}

module.exports = Resumable;