const mongoose = require('mongoose');
const { Schema } = mongoose;

const genreSchema = new Schema({
    name : {
        type : String,
        required : true
    },
    externalSystemId : {
        type : String,
        required : true,
        index : true
    },
    source : {
        type : String,
        required : true,
        enum : ['tmdb']
    },
    genreType : {
        type : String,
        required : true,
        enum : ['movie', 'tv'],
        index : true
    },
    createdAt : {
        type : Date,
        default : Date.now
    },
    updatedAt : {
        type : Date,
        default : Date.now
    }
})

module.exports = mongoose.model('Genre', genreSchema);