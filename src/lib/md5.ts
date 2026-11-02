import SparkMD5 from "spark-md5";

const CHUNK = 4 * 1024 * 1024;

/** MD5-Prüfsumme einer Datei (gleiches Format wie Googles md5Checksum). */
export async function md5OfFile(file: Blob): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer();
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    spark.append(await file.slice(offset, offset + CHUNK).arrayBuffer());
  }
  return spark.end();
}
