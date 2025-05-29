export function loadTexture(gl: WebGL2RenderingContext, url: string): Promise<WebGLTexture> {
    return new Promise((resolve, reject) => {
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // Temporary 1x1 pixel while loading
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
            gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128,128,128,255])
        );
        const img = new Image();
        img.crossOrigin = "";
        img.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            resolve(tex);
        };
        img.onerror = (e) => reject(e);
        img.src = url;
    });
}

// NEW: Load texture array function
export function loadTextureArray(gl: WebGL2RenderingContext, urls: string[]): Promise<WebGLTexture> {
    return new Promise(async (resolve, reject) => {
        try {
            const texture = gl.createTexture()!;
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
            
            // Load all images first
            const images: HTMLImageElement[] = [];
            for (const url of urls) {
                const img = new Image();
                img.crossOrigin = "";
                await new Promise<void>((imgResolve, imgReject) => {
                    img.onload = () => imgResolve();
                    img.onerror = imgReject;
                    img.src = url;
                });
                images.push(img);
            }
            
            // Assume all images are same size (use first image dimensions)
            const width = images[0].width;
            const height = images[0].height;
            const layers = images.length;
            
            // Allocate storage for the array texture
            gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(Math.max(width, height))) + 1, gl.RGBA8, width, height, layers);
            
            // Upload each image to its layer
            images.forEach((img, index) => {
                gl.texSubImage3D(
                    gl.TEXTURE_2D_ARRAY, 0,
                    0, 0, index,
                    img.width, img.height, 1,
                    gl.RGBA, gl.UNSIGNED_BYTE, img
                );
            });
            
            // Set texture parameters
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
            
            resolve(texture);
        } catch (error) {
            reject(error);
        }
    });
}