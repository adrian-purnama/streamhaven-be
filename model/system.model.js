const mongoose = require('mongoose');
const {LOG_NAME_ENUM, LOG_ENTRY_LIMIT} = require('../helper/log.helper');


const systemLogEntrySchema = new mongoose.Schema({
    logName: {
        type: String,
        required: true,
        enum: LOG_NAME_ENUM,
    },
    logTimestamp: {
        type: Date,
        default: Date.now,
    },
    log: {
        type: [String],
        default: [],
    },
}, { _id: false });

const systemSchema = new mongoose.Schema({
    appName : {
        type : String,
        required : true,
        default : "FC"
    },
    openRegistration : {
        type : Boolean,
        required : true,
        default : false
    },
    logoUrl : {
        type : String,
        default : ''
    },
    logoFullUrl : {
        type : String,
        default : ''
    },
    tagLine : {
        type : String,
        default : ''
    },
    abyssToken : {
        token : {
            type : String,
            default : ''
        },
        expiresAt : {
            type : Date,
            default : Date.now
        }
    },
    systemLogs: {
        type: [systemLogEntrySchema],
        default: [],
    },
});

/**
 * Append a new log entry (one run) for the given LOG_NAME. Each call adds one entry to systemLogs.
 * When systemLogs length exceeds LOG_ENTRY_LIMIT (100), the oldest entries are removed.
 * @param {string} logName - One of LOG_NAME_ENUM
 * @param {string[]} messages - Array of strings for this run (e.g. all lines from a process run)
 */
systemSchema.statics.appendLog = async function (logName, messages) {
    const lines = Array.isArray(messages) ? messages.map((m) => String(m)) : [String(messages)];
    if (lines.length === 0) return;
    const sys = await this.findOne({}).lean();
    if (!sys) return;
    const logs = sys.systemLogs || [];
    const newEntry = { logName, logTimestamp: new Date(), log: lines };
    let newSystemLogs = [...logs, newEntry];
    if (newSystemLogs.length > LOG_ENTRY_LIMIT) {
        newSystemLogs = newSystemLogs.slice(-LOG_ENTRY_LIMIT);
    }
    await this.updateOne({}, { $set: { systemLogs: newSystemLogs } });
};

module.exports = mongoose.model('System', systemSchema);