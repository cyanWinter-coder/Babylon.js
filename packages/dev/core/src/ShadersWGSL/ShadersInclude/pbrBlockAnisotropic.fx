#ifdef ANISOTROPIC
    struct anisotropicOutParams
    {
        anisotropy: f32,
        anisotropicTangent: vec3f,
        anisotropicBitangent: vec3f,
        anisotropicNormal: vec3f,
    #if DEBUGMODE > 0 && defined(ANISOTROPIC_TEXTURE)
        anisotropyMapData: vec3f
    #endif
    };

    #define pbr_inline
    fn anisotropicBlock(
        vAnisotropy: vec3f,
        roughness: f32,
    #ifdef ANISOTROPIC_TEXTURE
        anisotropyMapData: vec3f,
    #endif
        TBN: mat3x3f,
        normalW: vec3f,
        viewDirectionW: vec3f
    ) -> anisotropicOutParams
    {        
        var outParams: anisotropicOutParams;
        var anisotropy: f32 = clamp(vAnisotropy.b, -1.0, 1.0);
        var anisotropyDirection: vec2f = vAnisotropy.xy;
        let anisotropyDirectionLengthSquared: f32 = dot(anisotropyDirection, anisotropyDirection);
        if (anisotropyDirectionLengthSquared > 1e-8) {
            anisotropyDirection *= inverseSqrt(anisotropyDirectionLengthSquared);
        } else {
            anisotropyDirection = vec2f(1.0, 0.0);
        }

        #ifdef ANISOTROPIC_TEXTURE
            var amd = anisotropyMapData.rg;
            anisotropy = clamp(anisotropy * anisotropyMapData.b, -1.0, 1.0);

            #if DEBUGMODE > 0
                outParams.anisotropyMapData = anisotropyMapData;
            #endif

            amd = amd * 2.0 - 1.0;
            let amdLengthSquared: f32 = dot(amd, amd);
            if (amdLengthSquared > 1e-8) {
                amd *= inverseSqrt(amdLengthSquared);
            } else {
                amd = anisotropyDirection;
            }

            #ifdef ANISOTROPIC_LEGACY
                anisotropyDirection *= amd;
            #else
                anisotropyDirection = mat2x2f(anisotropyDirection.x, anisotropyDirection.y, -anisotropyDirection.y, anisotropyDirection.x) * amd;
            #endif
        #endif

        var anisoTBN: mat3x3f =  mat3x3f(normalize(TBN[0]), normalize(TBN[1]), normalize(TBN[2]));
        let finalDirectionLengthSquared: f32 = dot(anisotropyDirection, anisotropyDirection);
        if (finalDirectionLengthSquared > 1e-8) {
            anisotropyDirection *= inverseSqrt(finalDirectionLengthSquared);
        } else {
            anisotropyDirection = vec2f(1.0, 0.0);
        }
        var anisotropicTangent: vec3f = normalize(anisoTBN * vec3f(anisotropyDirection, 0.0));
        var anisotropicBitangent: vec3f = normalize(cross(anisoTBN[2], anisotropicTangent));
        
        outParams.anisotropy = anisotropy;
        outParams.anisotropicTangent = anisotropicTangent;
        outParams.anisotropicBitangent = anisotropicBitangent;
        outParams.anisotropicNormal = getAnisotropicBentNormals(anisotropicTangent, anisotropicBitangent, normalW, viewDirectionW, anisotropy, roughness);

        return outParams;
    }
#endif
