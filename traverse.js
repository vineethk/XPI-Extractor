var fs = require('fs');
var path = require('path');
var EventEmitter = require('events').EventEmitter;
var XULParser = require('./node_modules/xpi/lib/xulparser');

(function () {

    var Globals = {
        contentMap: {},

        visitJS: function() {
            this.files = {};
            this.count = 0;
        },

        visitXUL: function(max) {
            this.files = {};
            this.count = 0;
            this.max = max;
        }
    };

    Globals.visitJS.prototype.did = function(file) {
        this.count++;
        this.files[file] = this.count;
    }

    Globals.visitXUL.prototype.did = function(file) {
        this.count ++;
        this.files[file] = this.count;
    }

    Globals.visitXUL.prototype.done = function() {
        return (this.max === this.count);
    }

    var Util = {
        // remove trailing '/' if any
        preprocess: function(filePath) {
            return filePath.replace(/\/$/, "");
        },

        // returns an object with fields:
        // 1. jsList - an array of .js(m) files
        // 2. xulList - an array of .xul files
        // these are obtained by recursively looking into basePath
        getJXFilesFromBase: function(basePath) {
            var jsList = [];
            var xulList = [];

            // side effecting function
            // traverses the file system from the currentPath
            // fills up jsList and xulList
            function traverseFileSystem(currentPath) {
                var files = fs.readdirSync(currentPath);
                for (var i in files) {
                    var currentFile = currentPath + '/' + files[i];
                    if (/\.js(m?)$/.test(files[i]))
                        jsList.push(currentFile);
                    else if (/\.xul$/.test(files[i]))
                        xulList.push(currentFile);
                    var stats = fs.statSync(currentFile);
                    if (stats.isDirectory()) {
                        traverseFileSystem(currentFile);
                    }
                }
            }
            traverseFileSystem(basePath);
            return {
                jsList: jsList,
                xulList: xulList
            };
        },

        // takes in a base directory
        // looks at the mapping.manifest in it
        // parses it into a map, and returns it
        mappingReader: function (base) {
            var file = base + "/mapping.manifest";
            var lines = fs.readFileSync(file, 'utf-8').split("\n");
            var contentMapping = {};
            lines.forEach(function(line) {
                var tok = line.split(" ");
                contentMapping[tok[0].trim()] = base + "/" + tok[1].trim();
            });
            return contentMapping;
        },

        // returns an object { code: contents_of_the_file }
        getCodeFromJSFile: function(fileName) {
            var o = {};
            o.code = fs.readFileSync(fileName, 'utf-8');
            return o;
        },

        // calls the callback on the result of the parsing the .xul file
        // passed in as fileName
        // the callback receives an array
        // that has objects of the form {code: }
        getCodeFromXULFile: function(fileName, callback, contentMap) {
            var xp = new XULParser(fs.readFileSync(fileName, 'utf-8'), fileName, contentMap);

            xp.on("end", function(resultArray) {
                // in this resultArray, we have {code: } as well as {file: } objects
                // make them all {code: } objects
                for (var j = 0; j < resultArray.length; ++j) {
                    if ("file" in resultArray[j]) {
                        Globals.jsvisit.did(resultArray[j].file);
                        resultArray[j] = Util.getCodeFromJSFile(resultArray[j].file);
                    }
                }
                callback(resultArray);
            });

            xp.on("error", function(err) { console.log("Encountered the error: " + err); process.exit(-1); });
        },

        // reads the ordering.manifest file
        // this file has the order in which browser loads the .xul files
        manifestReader: function(fileName) {
            return fs.readFileSync(fileName, 'utf-8').
                split("\n").
                map(function (e) {
                    return path.normalize(e);
                });
        },

        // gets the xul code from those files in allFiles
        // that are not in visitedMap
        // once it gets all such code, it uses the xulSync to signal "done"
        // and sends an array of resultArrays
        // (a resultArray is an array of objects having the "code" field)
        getOtherXULCode: function (visitedMap, allFiles, xulSync) {
            // find all those XULs that have not been visit, count them and visit them
            var unvisitedXULs = [];
            var otherXULArrays = [];
            for (var iter = 0; iter < allFiles.length; ++iter) {
                if (!(allFiles[iter] in visitedMap))
                    unvisitedXULs.push(allFiles[iter]);
            }
            var unvisitedCounter = 0;
            unvisitedXULs.forEach(function (xulFile) {
                Util.getCodeFromXULFile(xulFile, function (resultArray) {
                    otherXULArrays.push(resultArray);
                    unvisitedCounter++;
                    if (unvisitedCounter == unvisitedXULs.length) {
                        xulSync.emit("done", otherXULArrays);
                    }
                })
            })
        },

        // gets concatenated code from allFiles
        // of all the .js(m) files that are not in visitedMap
        getOtherJSCode: function (visitedMap, allFiles) {
            var code = "";
            for (var iter = 0; iter < allFiles.length; ++ iter) {
                if (!(allFiles[iter] in visitedMap)) {
                    code += Util.getCodeFromJSFile(allFiles[iter]).code;
                }
            }
            return code;
        },

        // it goes through each element in arr, which is a resultArray,
        // each resultArray is an array of objects with "code" fields
        // the value of all "code" fields are concatenated
        concatCodeFields: function (arr) {
            var code = "";
            for (var elem = 0; elem < arr.length; ++elem) {
                for (var iter = 0; iter < arr[elem].length; ++iter) {
                    code += arr[elem][iter].code;
                }
            }
            return code;
        },

        // it concatenates the code fields in the resultArray
        // the resultArray is obtained from the xa
        // based on the ordering in ordering
        concatCodeFieldsInOrder: function (xa, ordering) {
            var code = "";
            for (var order = 0; order < ordering.length; ++order) {
                var arr = xa[ordering[order]];
                for (var iter = 0; iter < arr.length; ++iter) {
                    code += arr[iter].code;
                }
            }
            return code;
        }
};

    var root = Util.preprocess(process.argv[2]);
    var files = Util.getJXFilesFromBase(root);

    // perform initializations
    if (path.existsSync(root + "/mapping.manifest")) {
        Globals.contentMap = Util.mappingReader(root);
    }

    Globals.orderedXULList = [];
    // if we were able to obtain an ordering.manifest
    // make use of that
    if (path.existsSync(root + "/ordering.manifest")) {
        Globals.orderedXULList = Util.manifestReader(root + "/ordering.manifest");
    }

    Globals.jsvisit = new Globals.visitJS();
    Globals.xulvisit = new Globals.visitXUL(Globals.orderedXULList.length);

    Globals.XULResultArrays = {};

    // synchronizer for collecting xul files
    function XULSynchonyzer() {
        EventEmitter.call(this);
    }
    XULSynchonyzer.prototype = Object.create(EventEmitter.prototype);
    var xulSync = new XULSynchonyzer();

    Globals.orderedXULList.forEach(function(xulFile) {
        Util.getCodeFromXULFile(xulFile, function (resultArray) {
            Globals.XULResultArrays[xulFile] = resultArray;
            Globals.xulvisit.did(xulFile);
            if (Globals.xulvisit.done()) {
                Util.getOtherXULCode(Globals.xulvisit.files, files.xulList, xulSync);
            }
        });
    });

    // if we are immediately done
    if (Globals.xulvisit.done()) {
        Util.getOtherXULCode(Globals.xulvisit.files, files.xulList, xulSync);
    }

    xulSync.on("done", function (otherXULArrays) {
        var code = "";
        code += Util.concatCodeFieldsInOrder(Globals.XULResultArrays, Globals.orderedXULList);
        code += Util.concatCodeFields(otherXULArrays);
        code += Util.getOtherJSCode(Globals.jsvisit.files, files.jsList);
        console.log(code);
    });
})();