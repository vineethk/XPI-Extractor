var sax = require("sax");
var fs = require("fs");
var EventEmitter = require("events").EventEmitter;

var eventAttributes = {
    onblur: true,
    onchange: true,
    onclick: true,
    ondblclick: true,
    onfocus: true,
    onkeydown: true,
    onkeypress: true,
    onkeyup: true,
    onload: true,
    onmousedown: true,
    onmousemove: true,
    onmouseout: true,
    onmouseover: true,
    onmouseup: true,
    onselect: true,
    onunload: true,
    onbroadcast: true,
    onclose: true,
    oncommand: true,
    oncommandupdate: true,
    oncontextmenu: true,
    ondrag: true,
    ondragdrop: true,
    ondragend: true,
    ondragenter: true,
    ondragexit: true,
    ondraggesture: true,
    ondragover: true,
    oninput: true,
    onoverflow: true,
    onpopuphidden: true,
    onpopuphiding: true,
    onpopupshowing: true,
    onpopupshown: true,
    onsyncfrompreference: true,
    onsynctopreference: true,
    onunderflow: true,
    onbeforeaccept: true,
    onbookmarkgroup: true,
    onchange: true,
    onclick: true,
    onclosetab: true,
    oncommand: true,
    oncommandupdate: true,
    ondialogaccept: true,
    ondialogcancel: true,
    ondialogdisclosure: true,
    ondialogextra1: true,
    ondialogextra2: true,
    ondialoghelp: true,
    onerror: true,
    onerrorcommand: true,
    onextra1: true,
    onextra2: true,
    oninput: true,
    onload: true,
    onnewtab: true,
    onpageadvanced: true,
    onpagehide: true,
    onpagerewound: true,
    onpageshow: true,
    onpaneload: true,
    onpopuphidden: true,
    onpopuphiding: true,
    onpopupshowing: true,
    onpopupshown: true,
    onsearchcomplete: true,
    ontextcommand: true,
    ontextentered: true,
    ontextrevert: true,
    ontextreverted: true,
    onwizardback: true,
    onwizardcancel: true,
    onwizardfinish: true,
    onwizardnext: true
};

// interpolate escaped HTML entities
function unescape(s) {
    // FIXME: handle &nnnn; and &xhhhh; entities
    return s.replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/&apos;/g, "'")
            .replace(/&quot;/g, '"');
}

// wrap inline attribute handler scripts with their implicit function
function implicitHandlerFunction(src, filename, line, column) {
    // munge the handler name
    var munged = filename.replace(/[.\/]/g, "_")
        .replace(/[^a-zA-Z0-9_$]*/g, "");
    var handler = "$handler_" + munged + "_" + line + "_" + column;
    return "function " + handler + "(event) { " + src + "\r\n}\r\n" +
        "document.addEventListener(\"command\", " + handler + ", false);\r\n";
    //TODO: instead of document, do something more precise, like getElementByID
}

// creates an array of objects which it emits when the parser is done.
// each element of the array is an object, which is one of:
// 1. { code: String } -- has the code contents
// 2. { file: String } -- has the file name (in 3 forms)
// Note: an error could also be emitted
function XULParser(filename) {
    EventEmitter.call(this);
    var src = fs.readFileSync(filename, 'utf-8');
    var parser = sax.parser(false, { lowercase: true, noscript: true });
    var self = this;

    // SAX parsing context.
    var context = null;

    // SAX CDATA context.
    var cdata;

    // the array that we parse into and emit at the end
    var resultArray = [];

    function onText(text) {
        if (context && context.tag === "script") {
            resultArray.push({ code: unescape(text) });
        }
    }

    parser.onerror = function(err) {
        // hey, an error occurred instead
        self.emit("error", err);
    };

    parser.onopentag = function(tag) {
        var name = tag.name;
        var attributes = tag.attributes;

        if (name === "script") {
            context = {
                tag: "script",
                previous: context,
                line: parser.line + 1
            };
            if (attributes.src) {
                resultArray.push( {file: attributes.src} );
            }
        }
        else {
            for (attribField in attributes) {
                if ((attribField in eventAttributes)) {
                    resultArray.push({
                        code: implicitHandlerFunction(
                                unescape(attributes[attribField]),
                                filename, parser.line + 1, parser.column)
                    });
                }
            }
        }
    };

    parser.onclosetag = function(tag) {
        if (tag === "script")
            context = context.previous;
    };

    parser.onopencdata = function() {
        cdata = "";
    };

    parser.oncdata = function(text) {
        cdata += text;
    };

    parser.onclosecdata = function() {
        onText(cdata);
    };

    parser.ontext = onText;

    parser.onend = function() {
        self.emit("end", resultArray);
    };

    // Give the client a chance to register handlers before parsing.
    process.nextTick(function() {
        parser.write(src).close();
    });
}

XULParser.prototype = Object.create(EventEmitter.prototype);

module.exports = XULParser;

