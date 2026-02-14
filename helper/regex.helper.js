const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateLength(string){
    if(!string || string.length === 0 || string.length > 100){
        throw new Error('String is required and must be less than 100 characters')
    }
    return string
}

function validateAndCleanEmail(email) {
    if (!email) {
        throw new Error('Email is required')
    }
    email = validateLength(email)
    const cleaned = email.replace(/\s/g, '').toLowerCase().trim()
    if (!EMAIL_REGEX.test(cleaned)) {
        throw new Error('Invalid email format')
    }
    return cleaned
}

function validateAndCleanString(string, titleCase = false, uppercase = false, lowercase = false){
    if(!string){
        throw new Error('String is required')
    }
    if(titleCase){
        string = string.charAt(0).toUpperCase() + string.slice(1)
    }
    if(uppercase){
        string = string.toUpperCase()
    }
    if(lowercase){
        string = string.toLowerCase()
    }
    string = validateLength(string)
    return string.trim()
}

module.exports = { validateAndCleanEmail, validateAndCleanString }