var XULParser = require('./xulparser')
var fs = require('fs');

var fileName = process.argv[2];
try {
    var src = fs.readFileSync(fileName, 'utf-8');
    var xp = new XULParser(src, fileName);

    xp.on("end", function(resultArray) {
        console.log(JSON.stringify(resultArray));
    });

    xp.on("error", function (errObj) {
        console.log(JSON.stringify(errObj));
    });

} catch (e) {
    console.log(JSON.stringify(e));
}

