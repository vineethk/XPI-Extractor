import sys.process._
import util.parsing.json._
import java.io._

//val jxul: String = ("node xultojson.js " + args(0)).!!
//
//val xul = JSON.parseFull(jxul);
//println(xul)


import java.io._
import collection.mutable.{Map => MMap}
import collection.mutable.{Set => MSet}
import collection.mutable.ListBuffer

// constants
val lineSep = "\r\n"

// replace chrome://packagename/content/uri with the content mapping
// content packagename -> baseuri
// to get baseuri/uri
// if we cannot get all this info, return None
def convertChromeURI(cstr: String,
                     contentMapping: Map[String, String]): Option[String] = {
  val cp = """chrome:\/\/([a-zA-Z0-9_\.\-]+)\/content\/(.*)""".r
  cstr match {
    case cp(pname, uri) if (contentMapping contains pname) => Some(contentMapping(pname) + uri)
    case _ => None
  }
}

// transform url with jar: addresses
// to the way in which unbundle.py unpacks jars
// also remove file: from the start of the string
// also add / at the end if it doesnt already exist
def contentTransform(str: String): String = {
  val cleanerStr =
    (if (str.startsWith("jar:")) {
      val tok = str.drop(4).split("/")
      tok.map((e) => if (e.endsWith("!")) "_" + e.dropRight(1) else e).mkString("/")
    }
    else if (str.startsWith("file:")) str.drop(5)
    else str)

  if (!cleanerStr.endsWith("/")) cleanerStr + "/"
  else cleanerStr
}


// three possible outputs:
// able to successfully parse the manifest
// able to parse part of the manifest
// unable to parse the manifest
def manifestParser(base: String): (Boolean, List[String], Map[String, String]) = {
  val file = base + "/chrome.manifest"
  // first perform a content mapping and overlay collection
  val cmap = MMap[String, String]()
  // maintains order for overlays
  val overlays = ListBuffer[String]()

  if (!(new File(file)).exists()) { // too bad, no manifest
    return (false, List[String](), Map[String, String]())
  }

  for (line <- io.Source.fromFile(file).getLines()) {
    val tok = line.split("""[ \t]+""")
    if (tok.length > 0)
      tok(0).trim match {
        // this redefines the uri mapping
        case "content" => if (tok.length > 2) cmap(tok(1).trim) = contentTransform(tok(2).trim)
        // this defines the overlay
        case "overlay" => if (tok.length > 2) overlays += tok(2).trim
        // skip the rest of the commands, they are not relevant
        case _ => ;
      }
  }

  // convert overlays to file paths
  val filePaths = overlays.map(o => convertChromeURI(o, cmap.toMap) match {
    case Some(x) if (new File(base + "/" + x).exists()) => Some(base + "/" + x)
    case None => None
    case _ => None
  });

  val goodFilePaths = filePaths.flatMap(x => x).toList

  if (filePaths.length == goodFilePaths.length && filePaths.length > 0)
  // (true, nonelessFPs.mkString("\n"))
    (true, goodFilePaths, cmap.toMap)
  else
  //(false, nonelessFPs.mkString("\n"))
    (false, goodFilePaths, cmap.toMap)
}

object Helper {

  // gets all the .js(m) and .xul files
  // returns a tuple of list
  // ._1 are the .js(m) files
  // ._2 are the .xul files
  def getJXFiles(base: String): (List[String], List[String]) = {

    def traverseDirectory(path: String): (List[String], List[String]) = {
      val dir = new File(path)
      assert(dir.isDirectory)
      dir.listFiles.foldLeft((List[String](), List[String]()))(
        (acc, file) => {
          if (file.getPath.endsWith(".js") ||
              file.getPath.endsWith(".jsm"))
            (acc._1 ++ List(file.getPath), acc._2)
          else if (file.getPath.endsWith(".xul"))
            (acc._1, acc._2 ++ List(file.getPath))
          else if (file.isDirectory) {
            val (jsl, xull) = traverseDirectory(file.getPath)
            (acc._1 ++ jsl, acc._2 ++ xull)
          } else acc
        }
      )
    }

    traverseDirectory(base)
  }

  // for the xulfile at filename, using the manifest results,
  // return the code as well as all the js files looked into
  def getXULCode(filename: String,
                 manifestResults: (Boolean, List[String], Map[String, String])): (String, List[String]) = {
    // parse using xultojson.js
    val jxul: String = ("node xultojson.js " + args(0)).!!
    // convert back from json
    JSON.parseFull(jxul) match {
      case Some(x) => {
        println(x)
      }
      // failed reading the xul file; move on by returning empty string
      case None => ""
    }
    ("", List(""))
  }
  
  def getJSCode(filename: String): String = {
    io.Source.fromFile(filename).getLines.mkString(lineSep)
  }
}

// val (jsFiles, xulFiles) = Helper.getJXFiles(args(0))
Helper.getXULCode(args(0), manifestParser(args(0)))

//val dir = new File(args(0))
//
//for (file <- dir.listFiles) {
//  val (suc, str) = manifestParser(file.getPath)
//  if (str != "") {
//    val out = new PrintStream(new FileOutputStream(file.getPath + "/mapping.manifest"));
//    out.print(str)
//  }
//  if (suc)  {
//    //println(str)
//    //  val out = new PrintStream(new FileOutputStream(file.getPath + "/ordering.manifest"));
//    //  out.print(str)
//    //  out.close()
//  } else if (str != "") {
//    // println(str)
//    //  val out = new PrintStream(new FileOutputStream(file.getPath + "/partial.manifest"));
//    // out.print(str)
//    // out.close()
//  }
//}
