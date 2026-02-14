const mongoose = require('mongoose');
const { Schema } = mongoose;

const linksSchema = new Schema({
    label : {
        type : String,
        required : true
    },
    link : {
        type : String,
        required : true
    },
    icon : {
        type : String,
        default : ''
    }
})

const supporterSchema = new Schema({
    userId : {
        type : mongoose.Schema.Types.ObjectId,
        ref : 'user',
        required : true
    },
    supporterType : {
        type : String,
        required : true,
        enum : ['platinum', 'gold', 'silver', 'bronze']
    },
    displayName : {
        type : String,
        required : true
    },
    links : {
        type : [linksSchema],
        required : true
    },
    order : {
        type : Number,
        required : true,
        unique : true
    },
    tagLine : {
        type : String,
        default : ''
    },
    isVerified : {
        type : Boolean,
        default : false
    }
})

module.exports = mongoose.model('supporter', supporterSchema);