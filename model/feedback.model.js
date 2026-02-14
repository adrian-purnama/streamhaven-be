const mongoose = require('mongoose');
const { Schema } = mongoose;

const feedbackSchema = new Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: false
    },
    feedback: {
        type: String,
        required: true
    },
    feedbackType: {
        type: String,
        required: true,
        enum: ['register', 'feedback']
    }
}, { timestamps: true });

module.exports = mongoose.model('Feedback', feedbackSchema);

