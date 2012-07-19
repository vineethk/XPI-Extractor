var XULParser = require('./xulparser')
var fs = require('fs');

var fileName = process.argv[2];
var xp = new XULParser(fileName);

xp.on("end", function(resultArray) {
    console.log(JSON.stringify(resultArray));
});

xp.on("error", function (errObj) {
    console.log(JSON.stringify(errObj));
})
