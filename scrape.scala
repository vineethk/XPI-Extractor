import sys.process._
import util.parsing.json._
import java.io._
import collection.mutable.{Map => MMap}
import collection.mutable.{Set => MSet}
import collection.mutable.ListBuffer

object Helper {
  // constants
  val lineSep = "\r\n"

  // replace chrome://packagename/content/uri with the content mapping
  // content packagename -> baseuri
  // to get baseuri/uri
  // if we cannot get all this info, return None
  def convertChromeURI(cstr: String,
                       base: String,
                       contentMapping: Map[String, String]): Option[String] = {
    val cp = """chrome:\/\/([a-zA-Z0-9_\.\-]+)\/content\/(.*)""".r
    cstr match {
      case cp(pname, uri) if (contentMapping contains pname) =>
        Some(base + (if (base.endsWith("/")) "" else "/") + contentMapping(pname) + uri)
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


  // one of the three can happen
  // able to successfully parse the manifest ._1 == true
  // able to parse part of the manifest ._1 == false
  // unable to parse the manifest ._1 == false
  // ._2 == ordered existing file paths
  // ._3 == content mapping
  def manifestParser(base: String): (Boolean, List[String], Map[String, String]) = {
    val file = base + (if (base.endsWith("/")) "" else "/") + "chrome.manifest"
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
    // do it only if they exist
    val filePaths = overlays.map(o => convertChromeURI(o, base, cmap.toMap) match {
      case Some(x) if (new File(x).exists()) => Some(x)
      case None => None
      case _ => None
    });

    val goodFilePaths = filePaths.flatMap(x => x).toList

    if (filePaths.length == goodFilePaths.length && filePaths.length > 0)
      (true, goodFilePaths, cmap.toMap)
    else
      (false, goodFilePaths, cmap.toMap)
  }

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
                 base: String,
                 manifestResults: (Boolean, List[String], Map[String, String])): (String, List[String]) = {
    // parse using xultojson.js
    val jxul: String = ("node xultojson.js " + filename).!!
    // convert back from json
    JSON.parseFull(jxul) match {
        // the if is perhaps incorrect due to type erasure?
      case Some(x) if x.isInstanceOf[List[Map[String, String]]] => {
        val lst = x.asInstanceOf[List[Map[String, String]]]
        lst.foldLeft((lineSep, List[String]()))(
          (acc: (String, List[String]), m: Map[String, String]) => {
            if (m.contains("code")) {
              (acc._1 + lineSep + m("code"), acc._2)
            } else {
              assert((m.contains("file")))
              val cleanedURI = m("file").takeWhile(_ != ';')
              convertChromeURI(cleanedURI, base, manifestResults._3) match {
                case Some(x) => {
                  val normalizedPath = (new File(x)).getCanonicalPath
                  (acc._1 + lineSep + getJSCode(normalizedPath), acc._2 ++ List(normalizedPath))
                }
                  // its the normal file, add base path to it
                case None => {
                  // normalize this
                  val jsfile = filename.take(filename.lastIndexOf('/')) + "/" + cleanedURI
                  val normalizedPath = (new File(jsfile)).getCanonicalPath
                  (acc._1 + lineSep + getJSCode(jsfile), acc._2 ++ List(normalizedPath))
                }
              }
            }
          }
        )
      }
      // failed reading the xul file; move on by returning empty string
      case _ => (lineSep, List[String]())
    }
  }
  
  def getJSCode(filename: String): String = {
    // TODO: handle failing cases in a resistant manner using getAllFilesWithName
    if (new File(filename).exists())
      io.Source.fromFile(filename).getLines.mkString(lineSep)
    else lineSep
  }

  def getCodeFromXPIBase(base: String): String = {
    // 1. parse the manifest
    // 2. get the code from the various xul files in order given in the manifest & get the visited files
    // 3. traverse the directory & get js and xul files
    // 4. visit those xuls that have not yet been visited
    // 5. visit those jsfiles that have not yet been visited
    // 6. concatenate results of 2, 4 & 5.

    // 1
    val manifestInfo = manifestParser(base)

    def getXULCodeInList(lst: List[String]): (String, List[String]) = {
      lst.foldLeft((lineSep, List[String]()))(
        (acc: (String,  List[String]), e: String) => {
          val (code, visitedFiles) = getXULCode(e, base, manifestInfo)
          (acc._1 + lineSep + code, acc._2 ++ visitedFiles)
        }
      )
    }

    // 2
    // TODO: XUL files can refer to other XUL files, handle them
    val (manifestXCode, manifestReachableJSFiles) = getXULCodeInList(manifestInfo._2)

    // 3
    val (allJSFiles, allXFiles) = getJXFiles(base)

    // 4
    val setOfVisitedXFiles = manifestInfo._2.toSet
    val (otherXCode, otherReachableJSFiles) = getXULCodeInList(allXFiles.filterNot(setOfVisitedXFiles.contains(_)))

    // 5
    val setOfVisitedJSFiles = manifestReachableJSFiles.toSet ++ otherReachableJSFiles.toSet
    val otherJSCode = allJSFiles.filterNot(setOfVisitedJSFiles.contains(_)).foldLeft(lineSep)(
      (acc: String, e: String) => {
        acc + lineSep + getJSCode(e)
      }
    )

    manifestXCode + lineSep + otherXCode + lineSep + otherJSCode + lineSep
  }
}

Helper.getCodeFromXPIBase(args(0))
